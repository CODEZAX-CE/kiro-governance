# KG-02 Implementation Spec: EC2 Instance Provisioning + Self-Signed TLS Cert Setup

**Story ID:** KG-02 | **Epic:** Infrastructure (F-04) | **Sprint:** 1 | **Points:** 3 | **Dependency:** KG-01  
**AWS Profile:** sandbox | **Region:** us-east-1

---

## Overview

This story provisions the EC2 instance that hosts the MCP server (F-01). It adds to the existing `GovernanceStack` from KG-01 (do NOT create a new stack):
- **Compute:** EC2 instance (`t3.micro`, Amazon Linux 2023, x86_64)
- **Network:** Security group with TCP 443 inbound (0.0.0.0/0) + SSH from admin CIDR, Elastic IP
- **TLS:** Self-signed certificate generated on first boot (RSA 4096-bit, 365-day validity)
- **Software:** Node.js 20 LTS, CloudWatch agent
- **Orchestration:** CDK infrastructure additions to `infra/stacks/governance-stack.ts`

**Verification:** After deployment, Faraz extracts the cert fingerprint and stores it as GitHub Secret.

---

## 1. CDK Additions to `infra/stacks/governance-stack.ts`

### 1.1 VPC Lookup

Use the default VPC for the region (no custom VPC):

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// Inside GovernanceStack constructor
const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', {
  isDefault: true,
});
```

**Rationale:** SRS and Architect decision — simplest for POC. No custom subnetting or availability zone targeting needed.

### 1.2 Security Group

Create a security group named `kiro-gov-mcp-server-sg`:

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

const sg = new ec2.SecurityGroup(this, 'McpServerSg', {
  vpc,
  securityGroupName: 'kiro-gov-mcp-server-sg',
  description: 'kiro-governance MCP server',
  allowAllOutbound: true,
});

// Inbound: TCP 443 from anywhere (GitHub Actions + Kiro agent)
sg.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(443),
  'HTTPS MCP server',
);

// Inbound: SSH from admin CIDR only
const adminCidr = this.node.tryGetContext('adminCidr');
if (!adminCidr) {
  throw new Error('CDK context value adminCidr is required. Set it in cdk.json or pass --context adminCidr=YOUR_IP/32');
}
sg.addIngressRule(
  ec2.Peer.ipv4(adminCidr),
  ec2.Port.tcp(22),
  'SSH admin access',
);
```

**Key points:**
- `allowAllOutbound: true` — instance can reach Slack API, DynamoDB, SSM
- Port 443: 0.0.0.0/0 (per F-01 §2.5 — GitHub Actions has dynamic IPs)
- Port 22: limited to admin CIDR from `cdk.context` (will be set to user's IP before deploy)
- No explicit deny rules — security group default-deny inbound is sufficient

### 1.3 Elastic IP

Allocate and associate an Elastic IP to the instance:

```typescript
const eip = new ec2.CfnEIP(this, 'McpServerEip', { domain: 'vpc' });
```

**Rationale:** Stable public IP for GitHub Actions and Kiro agent to reach the MCP server. Associated to the instance below via `CfnEIPAssociation`.

### 1.4 EC2 Instance

Create the instance with instance profile, security group, and user data using the L2 `ec2.Instance` construct:

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// L2 Instance construct — simplifies launch configuration
const userData = ec2.UserData.forLinux();
attachUserDataScript(userData);

const instance = new ec2.Instance(this, 'McpServer', {
  vpc,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  machineImage: ec2.MachineImage.latestAmazonLinux2023(),
  securityGroup: sg,
  role: this.mcpServerRole, // Reference KG-01 role directly
  userData,
  userDataCausesReplacement: false,
  blockDevices: [{
    deviceName: '/dev/xvda',
    volume: ec2.BlockDeviceVolume.ebs(20, { encrypted: true }),
  }],
});

// Associate Elastic IP
const eipAssoc = new ec2.CfnEIPAssociation(this, 'McpServerEipAssoc', {
  instanceId: instance.instanceId,
  allocationId: elasticIp.attrAllocationId,
});
```

### 1.5 User Data Script

The user data script runs on first boot and configures the instance:

```typescript
function attachUserDataScript(userData: ec2.UserData): void {
  // Update packages
  userData.addCommands('dnf update -y');

  // Install Node.js 20 LTS via nvm
  userData.addCommands(
    'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
    'export NVM_DIR="/root/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    'nvm install 20',
    'nvm use 20',
    'nvm alias default 20',
  );

  // Verify Node.js
  userData.addCommands('node --version && npm --version');

  // Create /opt/kiro-governance directory
  userData.addCommands('mkdir -p /opt/kiro-governance');

  // Generate self-signed TLS certificate (idempotent)
  userData.addCommands(
    'if [ ! -f /opt/kiro-governance/cert.pem ]; then',
    '  openssl req -x509 -newkey rsa:4096 \\',
    '    -keyout /opt/kiro-governance/key.pem \\',
    '    -out /opt/kiro-governance/cert.pem \\',
    '    -days 365 -nodes \\',
    '    -subj "/CN=kiro-governance"',
    '  chmod 600 /opt/kiro-governance/key.pem',
    '  chmod 644 /opt/kiro-governance/cert.pem',
    'fi',
  );

  // Log the cert fingerprint to CloudWatch (for manual extraction)
  userData.addCommands(
    'echo "=== MCP Server TLS Cert Fingerprint ===" >> /var/log/user-data.log',
    'openssl x509 -in /opt/kiro-governance/cert.pem -noout -fingerprint -sha256 >> /var/log/user-data.log',
  );

  // Install CloudWatch agent
  userData.addCommands('dnf install -y amazon-cloudwatch-agent');

  // Create .env.example template (placeholders; actual secrets set after deploy)
  userData.addCommands(
    `cat > /opt/kiro-governance/.env.example << 'EOF'
TABLE_NAME=kiro-governance-tracker
AWS_REGION=us-east-1
MCP_API_KEY=REPLACE_WITH_REAL_KEY
TLS_CERT_PATH=/opt/kiro-governance/cert.pem
TLS_KEY_PATH=/opt/kiro-governance/key.pem
PORT=443
NODE_ENV=production
LOG_LEVEL=info
EOF`,
  );

  // Note: systemd service file is deployed separately in KG-03
  userData.addCommands(
    'echo "systemd service to be deployed in KG-03" >> /var/log/user-data.log',
  );
}
```

**Key points:**
- **Node.js:** Use nvm + RPM to install Node.js 20 LTS
- **PM2:** Installed but not yet configured (KG-03 uses systemd service instead)
- **TLS cert:** Self-signed, RSA 4096-bit, 365-day validity, generated in `/etc/kiro-gov/`
- **Fingerprint logging:** Emitted to `/var/log/user-data.log` so Faraz can SSH in and retrieve it
- **Permissions:** Key file (`key.pem`) is readable only by owner (600), cert is readable by others (644)
- **.env.example:** Template with all required env vars for reference

### 1.6 Stack Outputs

Add CloudFormation outputs so Faraz can retrieve the Elastic IP and instance details:

```typescript
new cdk.CfnOutput(this, 'ElasticIP', {
  value: eip.ref,
  description: 'MCP Server Elastic IP — use for MCP_SERVER_URL and SSH access',
  exportName: 'KiroGovernanceMcpServerEIP',
});

new cdk.CfnOutput(this, 'McpServerSecurityGroupId', {
  value: sg.securityGroupId,
  description: 'Security group ID for MCP server',
});

new cdk.CfnOutput(this, 'McpServerInstanceId', {
  value: instance.instanceId,
  description: 'EC2 instance ID for MCP server',
});
```

---

## 2. CDK Context Configuration

### 2.1 Update `infra/cdk.json`

Add the `adminCidr` context value:

```json
{
  "app": "npx ts-node bin/app.ts",
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true,
    "adminCidr": "YOUR_IP/32"
  }
}
```

**Instructions for Faraz:**
1. Replace `YOUR_IP` with your actual public IP address (e.g., `203.0.113.45/32`)
2. To find your IP: `curl -s https://checkip.amazonaws.com`
3. Commit this change to git before running `cdk deploy`

**Rationale:** Prevents SSH access from the internet; only the admin's IP can SSH to port 22.

---

## 3. CDK Stack Organization

The updated `GovernanceStack` class structure:

```typescript
export class GovernanceStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly mcpServerRole: iam.Role;
  // From this story:
  public readonly instance: ec2.CfnInstance;
  public readonly elasticIp: ec2.CfnEIP;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==================== From KG-01: DynamoDB, IAM Role ====================
    // (existing code)

    // ==================== KG-02: EC2 Instance & Network ====================
    // VPC lookup, security group, instance, Elastic IP
    // See sections 1.1–1.6 above
  }
}
```

**File location:** `infra/stacks/governance-stack.ts` (modify existing file, do NOT create new)

---

## 4. Post-Deploy Manual Steps

After `cdk deploy --profile sandbox` completes, Faraz must:

### 4.1 SSH into EC2 Instance

```bash
# Get the Elastic IP from CloudFormation outputs
ELASTIC_IP=$(aws cloudformation describe-stacks \
  --stack-name KiroGovernanceStack \
  --region us-east-1 \
  --profile sandbox \
  --query 'Stacks[0].Outputs[?OutputKey==`McpServerElasticIp`].OutputValue' \
  --output text)

# SSH (default AMI user is ec2-user)
ssh -i /path/to/keypair.pem ec2-user@$ELASTIC_IP
```

**Note:** You must have an EC2 key pair. If using CDK without specifying a key, provision one separately or add `keyName` to the CfnInstance config.

### 4.2 Extract TLS Certificate Fingerprint

Once logged into the instance:

```bash
# View the fingerprint that was logged during user data execution
tail -1 /var/log/user-data.log

# Or regenerate it from the cert file
openssl x509 -in /etc/kiro-gov/cert.pem -noout -fingerprint -sha256
```

**Output format:**
```
sha256 Fingerprint=AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
```

Copy the fingerprint part (colon-delimited hex string) — you'll need it for the next steps.

### 4.3 Store GitHub Encrypted Secrets

Visit your GitHub repository Settings → Secrets and Variables → Actions and create these secrets:

| Secret Name | Value | Source |
|-------------|-------|--------|
| `MCP_CERT_FINGERPRINT` | SHA-256 fingerprint from step 4.2 (colon-delimited) | Extracted from cert |
| `MCP_SERVER_URL` | `https://<ELASTIC_IP>` (e.g., `https://203.0.113.45`) | CloudFormation output |
| `MCP_API_KEY` | A random 32+ character string (e.g., UUID or `openssl rand -hex 16`) | Generate and keep secure |

**Example GitHub CLI:**
```bash
gh secret set MCP_CERT_FINGERPRINT --body "AA:BB:CC:..."
gh secret set MCP_SERVER_URL --body "https://203.0.113.45"
gh secret set MCP_API_KEY --body "abc123def456..."
```

### 4.4 Store API Key in SSM Parameter Store

The MCP server loads the API key from SSM on startup:

```bash
aws ssm put-parameter \
  --name /kiro-governance/config/mcp-api-key \
  --value '<same-value-as-MCP_API_KEY-secret>' \
  --type SecureString \
  --overwrite \
  --region us-east-1 \
  --profile sandbox
```

**Security note:** The API key is stored in SSM as a `SecureString` (encrypted with AWS-managed key). The MCP server reads it at startup and caches it in memory. GitHub Actions and Kiro agent must have the same API key to authenticate.

### 4.5 Verify EC2 Instance Connectivity

```bash
# From your local machine, test HTTPS connectivity to the instance
curl -k https://<ELASTIC_IP>/health \
  -H "X-API-Key: <MCP_API_KEY>"

# Expected response (even though the server isn't fully running yet):
# Connection refused or "Not Found" is OK at this stage
# HTTP 401 "Unauthorized" means security group is open but API key is wrong
```

At this stage, the MCP server is not yet running (will be started in KG-03), so connection errors are expected.

---

## 5. Acceptance Criteria Verification Map

| AC | Verification Method | Acceptance Evidence |
|----|---------------------|-------------------|
| **EC2 instance type t3.micro** | CloudFormation outputs / AWS Console | Instance ID visible in CloudFormation outputs; `aws ec2 describe-instances` shows `InstanceType=t3.micro` |
| **Amazon Linux 2023** | SSH into instance: `cat /etc/os-release` | Release shows "Amazon Linux release 2023 (AL2023)" |
| **Security group `kiro-gov-mcp-server-sg`** | AWS Console / `aws ec2 describe-security-groups` | Name visible; ingress rules: TCP 443 from 0.0.0.0/0, TCP 22 from admin CIDR; egress all traffic |
| **Inbound TCP 443 from 0.0.0.0/0** | Test: `curl https://<ELASTIC_IP>` from outside | Connection succeeds (may fail with TLS error without pinned cert, but port is open) |
| **Inbound TCP 22 from admin CIDR** | SSH login from admin IP | Connection succeeds; SSH login from other IPs times out (security group denies) |
| **Elastic IP attached to instance** | CloudFormation outputs / AWS Console | Elastic IP shown in outputs and attached to instance; does not change on reboot |
| **Node.js 20 LTS installed** | SSH: `node --version` | Output: `v20.x.x` |
| **Self-signed TLS cert at `/opt/kiro-governance/cert.pem`** | SSH: `ls -la /opt/kiro-governance/` | Files exist with correct permissions (600 key, 644 cert) |
| **TLS cert: RSA 4096, 365-day validity** | SSH: `openssl x509 -in /opt/kiro-governance/cert.pem -noout -text` | Public key size: 4096 bits; Validity: 365 days from generation date |
| **SHA-256 fingerprint extracted** | SSH: `openssl x509 -in /opt/kiro-governance/cert.pem -noout -fingerprint -sha256` | Output format: `sha256 Fingerprint=AA:BB:CC:...` |
| **Instance profile with `kiro-gov-mcp-server-role`** | SSH: `curl http://169.254.169.254/latest/meta-data/iam/security-credentials/` | Role name returned: `kiro-gov-mcp-server-role` |
| **IAM role permissions (DynamoDB, SSM)** | Verify in AWS Console / `aws iam get-role-policy` | Role policies include DynamoDB PutItem+Query, SSM GetParameter, KMS Decrypt DENY restrictions |
| **CloudWatch agent installed** | SSH: `which amazon-cloudwatch-agent` or `systemctl status amazon-cloudwatch-agent` | Binary found; agent can be started/stopped |
| **Elastic IP in CloudFormation outputs** | CloudFormation stack outputs | `McpServerElasticIp` output visible with value like `203.0.113.45` |
| **GitHub Secrets created** | GitHub repo Settings → Secrets | `MCP_CERT_FINGERPRINT`, `MCP_SERVER_URL`, `MCP_API_KEY` all visible (values masked) |
| **API key in SSM SecureString** | `aws ssm get-parameter --name /kiro-governance/config/mcp-api-key --with-decryption --profile sandbox` | Parameter returned with decrypted value (matches GitHub secret) |

---

## 6. Definition of Done

- [ ] `infra/stacks/governance-stack.ts` updated with EC2 + VPC + Security Group + Elastic IP code
- [ ] `infra/cdk.json` updated with `adminCidr` context value set to Faraz's IP
- [ ] `cdk deploy --profile sandbox` succeeds with no errors
- [ ] EC2 instance is running and reachable on port 443 (security group allows it)
- [ ] Node.js 20 LTS is installed on the instance
- [ ] Self-signed TLS certificate generated at `/opt/kiro-governance/cert.pem` with RSA 4096 and 365-day validity
- [ ] TLS certificate fingerprint extracted via `openssl x509 -noout -fingerprint -sha256`
- [ ] Elastic IP allocated and associated to the instance
- [ ] Elastic IP printed in CloudFormation outputs
- [ ] SSH access from admin CIDR verified; SSH access from other IPs denied
- [ ] GitHub Encrypted Secrets created: `MCP_CERT_FINGERPRINT`, `MCP_SERVER_URL`, `MCP_API_KEY`
- [ ] API key stored in SSM Parameter Store at `/kiro-governance/config/mcp-api-key` as SecureString
- [ ] Code follows project conventions (CDK naming, no hardcoded secrets, organized in existing stack)
- [ ] No merge conflicts with KG-01 CDK changes
- [ ] PR includes summary of manual post-deploy steps (for next developer running KG-03)

---

## 7. Implementation Notes

### 7.1 EC2 Key Pair Handling

The CDK code above does not specify an EC2 key pair. To SSH into the instance, you must:
- Option A: Use an existing key pair name via `keyName` parameter in CfnInstance
- Option B: Use AWS Systems Manager Session Manager (no SSH key needed, if IAM role permits)
- Option C: Provision a new key pair via CDK before creating the instance

**Recommendation for POC:** Use Session Manager (simplest), or add a `keyName` parameter:

```typescript
const instance = new ec2.CfnInstance(this, 'McpServerInstance', {
  // ...existing config...
  keyName: this.node.tryGetContext('ec2KeyName') || 'my-default-key',
  // ...
});
```

Then set `ec2KeyName` in `cdk.context.json`.

### 7.2 Amazon Linux 2023 AMI Selection

The code above uses `ec2.AmazonLinuxImage.LATEST_AMZN_LINUX_2023`. This automatically resolves to the latest AL2023 AMI. Alternative: use explicit AMI ID for reproducibility:

```typescript
imageId: 'ami-0c55b159cbfafe1f0', // Example AL2023 AMI (region-specific)
```

Check the [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/AWSEC2/latest/Userguide/linux-ami-search.html) for the latest AMI ID in your region.

### 7.3 User Data Idempotency

The user data script above is **not idempotent**. If the instance is stopped and restarted, it will re-run, potentially regenerating the TLS certificate. To prevent this:

```typescript
// In user data, check if cert already exists
userData.addCommands(
  'if [ ! -f /etc/kiro-gov/cert.pem ]; then',
  '  openssl req -x509 -newkey rsa:4096 ...',
  'else',
  '  echo "Cert already exists, skipping generation"',
  'fi',
);
```

### 7.4 Network Configuration

The instance is placed in a public subnet (`vpc.publicSubnets[0]`) so the Elastic IP is reachable from the internet. This is required for GitHub Actions and remote Kiro agents. For higher security, consider:
- Private subnet + NAT Gateway (adds cost, complexity)
- VPC endpoint for SSM (allows service manager login without internet)

For POC, public subnet + security group restrictions is adequate.

---

## 8. Related Stories & Blockers

| Blocker | Story | Status |
|---------|-------|--------|
| **Depends on:** CDK stack, DynamoDB table, IAM role | KG-01 | ✅ Complete (KG-02 uses exports) |
| **Blocked by:** None | — | ✅ Ready to implement |
| **Blocks:** MCP server scaffold, tools | KG-03, KG-04 | Unblocked after this story merges |

---

## 9. Cost Estimate (KG-02 Component)

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| EC2 t3.micro on-demand | $7.49 | 24/7 operation; $0.0104/hr × 720 hr/mo |
| Elastic IP (attached) | $0.00 | Free while attached; $0.005/hr if unattached |
| Data transfer out | ~$0.05–0.20 | Minimal traffic (MCP calls + log shipment) |
| **Total KG-02 (EC2 + EIP)** | **~$7.50–7.70/mo** | Aligns with SRS NFR-05 (~$8/mo total EC2) |

---

## 10. Security Considerations

### 10.1 Self-Signed Certificate

The self-signed TLS cert (Option B from F-01 §2.4) is appropriate for POC because:
- ✅ Zero cost (no ACM certificate)
- ✅ No DNS validation required
- ✅ Clients pin via SHA-256 fingerprint (not CA trust chain)
- ⚠️ Certificate expiration (365 days) — requires manual rotation

**Production upgrade path:** Replace with ACM certificate + Application Load Balancer (ALB) for $15–20/mo.

### 10.2 Public IP on Port 443

Port 443 is open to 0.0.0.0/0 because GitHub Actions runners use dynamic public IPs (not whitelistable). Mitigations:
- ✅ X-API-Key header validation (shared secret)
- ✅ TLS certificate pinning (prevents MITM)
- ✅ Minimal API surface (only 2 MCP tools)
- ⚠️ No per-caller rate limiting (accepted for POC)

### 10.3 SSH from Admin CIDR

Port 22 is restricted to a single CIDR block (Faraz's IP). This prevents:
- ❌ Dictionary attacks on SSH from the internet
- ❌ Accidental public exposure of the server

**Enforcement:** If Faraz's IP changes, he must update `cdk.context.json` and re-deploy. Consider documenting this in a runbook for future operators.

---

## 11. Deployment Checklist

Before running `cdk deploy --profile sandbox`:

- [ ] KG-01 has been deployed successfully (`cdk deploy` completed)
- [ ] CloudFormation exports from KG-01 are available
- [ ] `cdk.context.json` has been updated with `adminCidr: "<your-ip>/32"`
- [ ] AWS CLI configured with `sandbox` profile and correct region (`us-east-1`)
- [ ] IAM permissions to create EC2, security groups, Elastic IPs, CloudWatch log groups
- [ ] SSH key pair exists or will be created (see section 7.1)
- [ ] No syntax errors: `cd infra && npx cdk synth`

**Deploy command:**
```bash
cd infra
npx cdk deploy KiroGovernanceStack --profile sandbox --require-approval broadening
```

**Expected output:**
```
✅ KiroGovernanceStack
Outputs:
  McpServerElasticIp = 203.0.113.45
  McpServerInstanceId = i-0123456789abcdef0
  McpServerSecurityGroupId = sg-0123456789abcdef0
```

---

*End of KG-02 Implementation Spec*
