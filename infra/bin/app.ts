import * as cdk from 'aws-cdk-lib';
import { GovernanceStack } from '../stacks/governance-stack';

const app = new cdk.App();

new GovernanceStack(app, 'KiroGovernanceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Kiro Governance — F-04 Data & Persistence (DynamoDB + IAM + SSM)',
});

app.synth();
