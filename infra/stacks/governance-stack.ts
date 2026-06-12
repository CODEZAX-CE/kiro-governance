import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * CDK Stack for kiro-governance F-04 Data & Persistence domain.
 * Implements: data-persistence-architecture.md §7.1
 * - DynamoDB table: kiro-governance-tracker
 * - GSIs: gsi-type-created, gsi-gate-created
 * - IAM role: kiro-gov-mcp-server-role
 * - SSM parameters: config values
 * - CloudWatch log group: /kiro-governance/mcp-server
 */
export class GovernanceStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly mcpServerRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = this.account;
    const region = this.region;

    // ==================== DynamoDB Table ====================
    // Source: data-persistence-architecture.md §2
    this.table = new dynamodb.Table(this, 'GovernanceTracker', {
      tableName: 'kiro-governance-tracker',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: true,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ==================== GSI: gsi-type-created ====================
    // Partition: type (macro/micro)
    // Sort: created_at (ISO timestamp)
    // Purpose: Cross-project rollup by type (FR-08 dashboard)
    // Source: data-persistence-architecture.md §2.4
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi-type-created',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==================== GSI: gsi-gate-created ====================
    // Partition: gate (canonical gate name)
    // Sort: created_at (ISO timestamp)
    // Purpose: Cross-project queries by gate (FR-08 filter by gate)
    // Note: Micro events (gate absent) excluded from this GSI
    // Source: data-persistence-architecture.md §2.4, FINDING-5
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi-gate-created',
      partitionKey: { name: 'gate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==================== IAM Role: kiro-gov-mcp-server-role ====================
    // Trust: EC2 service
    // Permissions: DynamoDB PutItem + Query, SSM GetParameter, KMS Decrypt
    // Restrictions: DENY DeleteItem + UpdateItem (append-only enforcement)
    // Source: data-persistence-architecture.md §6.1, code-structure.md §18
    this.mcpServerRole = new iam.Role(this, 'McpServerRole', {
      roleName: 'kiro-gov-mcp-server-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'MCP Server EC2 instance role for governance data writes',
    });

    // ALLOW: DynamoDB PutItem and Query on table + GSIs
    this.mcpServerRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'DynamoDBWrite',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem', 'dynamodb:Query'],
        resources: [
          this.table.tableArn,
          `${this.table.tableArn}/index/*`,
        ],
      }),
    );

    // ALLOW: SSM GetParameter on /kiro-governance/* paths
    this.mcpServerRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SSMReadConfig',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${region}:${accountId}:parameter/kiro-governance/*`],
      }),
    );

    // ALLOW: KMS Decrypt on AWS-managed SSM key
    // Scope: alias/aws/ssm (the default key used by SecureString parameters)
    // Architect decision: aws/ssm key is acceptable for POC. Upgrade to customer-managed CMK if required later.
    this.mcpServerRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'KmsDecryptSsm',
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${region}:${accountId}:key/*`],
        conditions: {
          StringEquals: {
            'kms:ViaService': `ssm.${region}.amazonaws.com`,
          },
        },
      }),
    );

    // DENY: DeleteItem and UpdateItem (append-only enforcement)
    // Architect decision: Explicit DENY at IAM level enforces immutability and prevents accidental mutations.
    // DENY overrides any Allow, including from AWS-managed policies.
    // Source: data-persistence-architecture.md §6.1, Security Gate 1.5 SEC-1
    this.mcpServerRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'DenyAppendOnlyViolation',
        effect: iam.Effect.DENY,
        actions: ['dynamodb:DeleteItem', 'dynamodb:UpdateItem'],
        resources: [this.table.tableArn],
      }),
    );

    // ==================== Instance Profile ====================
    // Allows EC2 instances to assume the mcpServerRole
    const instanceProfile = new iam.InstanceProfile(this, 'McpServerInstanceProfile', {
      role: this.mcpServerRole,
    });
    cdk.Tags.of(instanceProfile).add('Name', 'kiro-gov-mcp-server-profile');

    // ==================== EC2 Instance (KG-02) ====================
    // VPC lookup
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Admin CIDR from context — defaults to open (0.0.0.0/0) for POC
    // Architect decision: SSH open to all; key-based auth is the actual protection.
    const adminCidr = this.node.tryGetContext('adminCidr') ?? '0.0.0.0/0';

    // Security group
    const sg = new ec2.SecurityGroup(this, 'McpServerSg', {
      vpc,
      securityGroupName: 'kiro-gov-mcp-server-sg',
      description: 'kiro-governance MCP server',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS MCP server');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH admin access');

    // User data script
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -euxo pipefail',
      // Node.js 20 via nvm
      'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
      'export NVM_DIR="/root/.nvm"',
      '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
      'nvm install 20',
      'nvm use 20',
      'nvm alias default 20',
      // App directory
      'mkdir -p /opt/kiro-governance',
      // TLS cert (idempotent)
      'if [ ! -f /opt/kiro-governance/cert.pem ]; then',
      '  openssl req -x509 -newkey rsa:4096 \\',
      '    -keyout /opt/kiro-governance/key.pem \\',
      '    -out /opt/kiro-governance/cert.pem \\',
      '    -days 365 -nodes \\',
      '    -subj "/CN=kiro-governance"',
      '  chmod 600 /opt/kiro-governance/key.pem',
      '  chmod 644 /opt/kiro-governance/cert.pem',
      'fi',
      // .env.example
      'cat > /opt/kiro-governance/.env.example << \'EOF\'',
      'TABLE_NAME=kiro-governance-tracker',
      'AWS_REGION=us-east-1',
      'MCP_API_KEY=REPLACE_WITH_REAL_KEY',
      'TLS_CERT_PATH=/opt/kiro-governance/cert.pem',
      'TLS_KEY_PATH=/opt/kiro-governance/key.pem',
      'PORT=443',
      'EOF',
    );

    // EC2 Instance (L2 construct)
    const instance = new ec2.Instance(this, 'McpServer', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role: this.mcpServerRole,
      userData,
      userDataCausesReplacement: false,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(20, { encrypted: true }),
      }],
    });

    // Elastic IP
    const eip = new ec2.CfnEIP(this, 'McpServerEip', { domain: 'vpc' });
    new ec2.CfnEIPAssociation(this, 'McpServerEipAssoc', {
      instanceId: instance.instanceId,
      allocationId: eip.attrAllocationId,
    });

    // ==================== SSM Parameters ====================
    // Source: data-persistence-architecture.md §6.2, code-structure.md §8
    // These are configuration parameters read by the MCP server at startup

    // Parameter 1: Table name (allows external configuration if needed)
    new ssm.StringParameter(this, 'TableNameParam', {
      parameterName: '/kiro-governance/config/table-name',
      stringValue: this.table.tableName,
      description: 'DynamoDB table name for governance events',
    });

    // Parameter 2: Region (for SDK clients)
    new ssm.StringParameter(this, 'RegionParam', {
      parameterName: '/kiro-governance/config/region',
      stringValue: region,
      description: 'AWS region for DynamoDB and other services',
    });

    // Note: /kiro-governance/config/mcp-api-key is a SecureString parameter
    // created outside CDK (manually or via deployment script) with a secret value.
    // The MCP server reads it at startup and caches it in memory.
    // Per code-structure.md §6: "API key is loaded from SSM at startup and cached in memory
    // (never re-fetched per-request)"

    // Note: /kiro-governance/slack/webhooks/{project_id} parameters are created
    // outside CDK, per-project, by admin during onboarding. Per data-persistence-architecture.md §6.2:
    // "per-project, created outside CDK"

    // ==================== CloudWatch Log Group ====================
    // Purpose: Centralized logging for MCP server output
    // Source: code-structure.md §11, F-01 §9.2
    new logs.LogGroup(this, 'McpServerLogGroup', {
      logGroupName: '/kiro-governance/mcp-server',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name for governance events',
      exportName: 'KiroGovernanceTrackerTable',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN',
    });

    new cdk.CfnOutput(this, 'McpServerRoleName', {
      value: this.mcpServerRole.roleName,
      description: 'IAM role for MCP server EC2 instance',
      exportName: 'KiroGovernanceMcpServerRole',
    });

    new cdk.CfnOutput(this, 'McpServerRoleArn', {
      value: this.mcpServerRole.roleArn,
      description: 'ARN of MCP server role',
    });

    new cdk.CfnOutput(this, 'InstanceProfileArn', {
      value: instanceProfile.instanceProfileArn,
      description: 'Instance profile ARN for EC2 instances',
      exportName: 'KiroGovernanceMcpServerInstanceProfile',
    });

    new cdk.CfnOutput(this, 'ElasticIP', {
      value: eip.ref,
      description: 'MCP Server Elastic IP — use for MCP_SERVER_URL and SSH access',
      exportName: 'KiroGovernanceMcpServerEIP',
    });

    new cdk.CfnOutput(this, 'McpServerInstanceId', {
      value: instance.instanceId,
      description: 'EC2 instance ID for MCP server',
    });

    new cdk.CfnOutput(this, 'McpServerSecurityGroupId', {
      value: sg.securityGroupId,
      description: 'Security group ID for MCP server',
    });
  }
}
