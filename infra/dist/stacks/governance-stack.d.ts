import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
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
export declare class GovernanceStack extends cdk.Stack {
    readonly table: dynamodb.Table;
    readonly mcpServerRole: iam.Role;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
