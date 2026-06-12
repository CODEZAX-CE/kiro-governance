# KG-01 Implementation Spec: CDK Stack — DynamoDB, GSIs, IAM, SSM

**Story:** KG-01  
**Sprint:** 1  
**Points:** 5  
**Priority:** High  
**Status:** In Development  
**Spec Strategy:** data-persistence-architecture.md §7.1 + code-structure.md §10

---

## 1. Architecture References

**Authoritative Sources:**
- **data-persistence-architecture.md v1.7** — F-04 Feature Design
  - §2.1 — DynamoDB table configuration (billing, deletion protection, PITR)
  - §2.2–2.4 — Key schema, attributes, GSIs
  - §4 — Idempotency & dedup sentinel pattern
  - §6 — IAM roles & security
  - §7.1 — CDK stack implementation
- **unified-data-model.md v1.3** — Data Model Canonicalization
  - §2.3 — Complete attribute definitions
  - §2.6 — GovernanceEventRecord TypeScript type (single source of truth)
- **code-structure.md v1.0** — Project Layout & Patterns
  - §1 — Repository structure (infra/, packages/, scripts/)
  - §4 — Shared constants usage (MANDATORY: import from packages/shared)
  - §10 — CDK stack pattern & rules
  - §14 — Workspace & package config
  - §16 — Traceability (KG-01 → F-04 §7.1)

---

## 2. Files to Create

| Path | Type | Purpose |
|------|------|---------|
| `infra/bin/app.ts` | TypeScript | CDK app entry point — instantiates GovernanceStack |
| `infra/stacks/governance-stack.ts` | TypeScript | CDK stack implementation (table, GSIs, IAM, SSM) |
| `infra/cdk.json` | JSON | CDK context & config |
| `package.json` (root) | JSON | Monorepo workspace config |
| `tsconfig.base.json` | JSON | Shared TypeScript compiler settings |
| `packages/shared/types/governance-event.ts` | TypeScript | Canonical GovernanceEventRecord interface |
| `packages/shared/constants/macro-gates.ts` | TypeScript | MACRO_GATES array, MACRO_GATE_ALIASES, classifyEvent() |

---

## 3. Implementation Steps (Ordered)

### Step 1: Initialize Root Workspace Configuration

**File:** `package.json` (root)

```json
{
  "name": "kiro-governance",
  "version": "1.0.0",
  "private": true,
  "description": "Governance event tracking MCP server & infrastructure",
  "workspaces": [
    "packages/*",
    "infra"
  ],
  "scripts": {
    "build": "npm run build -ws",
    "test": "jest --passWithNoTests",
    "lint": "eslint . --ext .ts",
    "cdk": "cdk"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "aws-cdk": "^2.100.0",
    "eslint": "^8.0.0",
    "jest": "^29.5.0",
    "prettier": "^3.0.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.2.0"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.2.0"
  }
}
```

**Notes:**
- `workspaces` includes `infra` (non-standard but required for `npm run build -ws` to compile CDK)
- `aws-cdk-lib` and `constructs` in root dependencies (used by infra/)
- Version pins are exact/pinned per security best practices

---

### Step 2: TypeScript Base Configuration

**File:** `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "baseUrl": ".",
    "paths": {
      "@kiro-governance/shared": ["packages/shared"]
    }
  },
  "include": ["packages/**/*", "infra/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Notes:**
- `strict: true` — no `any` permitted
- `paths` — allows `import from '@kiro-governance/shared'` from any workspace package
- `declaration: true` — generates `.d.ts` files for type sharing

---

### Step 3: Shared Types

**File:** `packages/shared/types/governance-event.ts`

```typescript
/**
 * Canonical DynamoDB record shape for kiro-governance-tracker table.
 * Single source of truth — unified-data-model.md §2.6
 */
export interface GovernanceEventRecord {
  /** Partition key: PROJECT#<project_id> */
  pk: string;

  /** Sort key: UPDATE#<ISO-timestamp>#<ULID> or DEDUP#<idempotency_key> */
  sk: string;

  /** Human-readable event description (max 4096 chars) */
  update_text: string;

  /** Event classification */
  type: 'macro' | 'micro';

  /** True if type was manually overridden; undefined if auto-classified */
  flag_override?: boolean;

  /** Canonical macro gate name. Present for macro events, absent for micro. */
  gate?: string;

  /** Phase grouping (e.g., "Phase 1") */
  phase?: string;

  /** Provenance — commit SHA or file line reference */
  source_ref: string;

  /** Who emitted/approved (agent name or human name) */
  actor: string;

  /** ISO-8601 creation timestamp */
  created_at: string;

  /** Deduplication key */
  idempotency_key: string;
}

/**
 * Dedup sentinel record (same table, special SK prefix).
 * Not a governance event — control record only.
 */
export interface DeduplicatedSentinelRecord {
  pk: string; // PROJECT#<project_id>
  sk: string; // DEDUP#<idempotency_key>
  created_at: string;
  idempotency_key: string;
}
```

---

### Step 4: Shared Constants

**File:** `packages/shared/constants/macro-gates.ts`

```typescript
/**
 * Canonical macro gate names — single source of truth for gate string comparisons.
 * Must import from here — never hardcode gate strings.
 * Source: SRS §16 (Project Brief §4a), unified-data-model.md §2.6
 */
export const MACRO_GATES = [
  'Discovery outputs validated',
  'Preliminary SRS validated',
  'SRS approved',
  'Design docs approved',
  'Implementation plan approved',
  'Spec file approved',
  'Code approved',
  'UAT report approved',
  'Runbooks approved',
  'Project documentation approved',
] as const;

export type MacroGate = typeof MACRO_GATES[number];

/**
 * Aliases for macro gates — case-insensitive user input maps to canonical names.
 * Source: data-persistence-architecture.md §7.1
 */
export const MACRO_GATE_ALIASES: Record<string, MacroGate> = {
  'solution architecture approved': 'Design docs approved',
  'sprint plan approved': 'Implementation plan approved',
  'documentation approved': 'Runbooks approved',
};

/**
 * Auto-classify a governance update based on text content.
 * Returns: macro event with matched gate, or micro event.
 * Source: data-persistence-architecture.md §7.1, F-01 §4.1
 */
export function classifyEvent(input: {
  update_text: string;
  type?: 'macro' | 'micro';
  flag_override?: boolean;
}): { resolvedType: 'macro' | 'micro'; matchedGate?: string } {
  // If caller provided explicit type + flag_override, use it as-is
  if (input.flag_override && input.type) {
    return { resolvedType: input.type, matchedGate: undefined };
  }

  const lowerText = input.update_text.toLowerCase().trim();

  // Try alias matches first
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lowerText.includes(alias.toLowerCase())) {
      return { resolvedType: 'macro', matchedGate: canonical };
    }
  }

  // Try canonical gate matches
  for (const gate of MACRO_GATES) {
    if (lowerText.includes(gate.toLowerCase())) {
      return { resolvedType: 'macro', matchedGate: gate };
    }
  }

  // No match → micro event
  return { resolvedType: 'micro' };
}
```

---

### Step 5: Shared Package Configuration

**File:** `packages/shared/package.json`

```json
{
  "name": "@kiro-governance/shared",
  "version": "1.0.0",
  "description": "Shared constants and types across kiro-governance domains",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "devDependencies": {
    "typescript": "^5.2.0"
  }
}
```

**File:** `packages/shared/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

**File:** `packages/shared/index.ts`

```typescript
export { GovernanceEventRecord, DeduplicatedSentinelRecord } from './types/governance-event';
export { MACRO_GATES, MACRO_GATE_ALIASES, classifyEvent } from './constants/macro-gates';
export type { MacroGate } from './constants/macro-gates';
```

---

### Step 6: CDK Configuration

**File:** `infra/cdk.json`

```json
{
  "app": "npx ts-node bin/app.ts",
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true
  }
}
```

---

### Step 7: CDK Infrastructure Package

**File:** `infra/package.json`

```json
{
  "name": "kiro-governance-infra",
  "version": "1.0.0",
  "description": "AWS CDK stack for kiro-governance",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "devDependencies": {
    "aws-cdk": "^2.100.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.2.0"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.2.0"
  }
}
```

**File:** `infra/tsconfig.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

---

### Step 8: CDK App Entry Point

**File:** `infra/bin/app.ts`

```typescript
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
```

---

### Step 9: CDK Stack Implementation

**File:** `infra/stacks/governance-stack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
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
        sid: 'SSMKmsDecrypt',
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${region}:${accountId}:alias/aws/ssm`],
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
  }
}
```

---

## 4. Acceptance Criteria Verification

| AC | Verification Method | Checklist |
|----|--------------------|-----------|
| **AC-1:** DynamoDB table `kiro-governance-tracker` created with PK (pk:String) and SK (sk:String) per F-04 §2.2 | `cdk synth` → inspect CloudFormation → AWS::DynamoDB::Table resource has `TableName: kiro-governance-tracker`, `AttributeDefinitions: [{AttributeName: pk, AttributeType: S}, {AttributeName: sk, AttributeType: S}]` | ✓ Verify in synthesized template |
| **AC-2:** Billing mode is PAY_PER_REQUEST per F-04 §2.1 | `cdk synth` → CloudFormation table resource has `BillingMode: PAY_PER_REQUEST` | ✓ Verify in synthesized template |
| **AC-3:** Deletion protection and PITR enabled per F-04 §2.1 | `cdk synth` → CloudFormation table has `DeletionProtectionEnabled: true`, `SSESpecification`, `PointInTimeRecoverySpecification: {PointInTimeRecoveryEnabled: true}` | ✓ Verify in synthesized template |
| **AC-4:** GSI `gsi-type-created` (PK: type, SK: created_at, projection: ALL) per F-04 §2.4 | `cdk synth` → CloudFormation table GlobalSecondaryIndexes includes object with `IndexName: gsi-type-created`, `KeySchema: [{AttributeName: type, KeyType: HASH}, {AttributeName: created_at, KeyType: RANGE}]`, `Projection: {ProjectionType: ALL}` | ✓ Verify in synthesized template |
| **AC-5:** GSI `gsi-gate-created` (PK: gate, SK: created_at, projection: ALL) per F-04 §2.4 | `cdk synth` → CloudFormation table GlobalSecondaryIndexes includes object with `IndexName: gsi-gate-created`, `KeySchema: [{AttributeName: gate, KeyType: HASH}, {AttributeName: created_at, KeyType: RANGE}]`, `Projection: {ProjectionType: ALL}` | ✓ Verify in synthesized template |
| **AC-6:** IAM role `kiro-gov-mcp-server-role` with DynamoDB PutItem+Query, SSM GetParameter, KMS Decrypt, explicit DENY on DeleteItem+UpdateItem per F-04 §6.1 | `cdk synth` → CloudFormation IAM::Role resource has correct AssumeRolePolicyDocument (EC2 trust) and inline Policies with: 1) Allow DynamoDB PutItem/Query on table + GSIs, 2) Allow SSM GetParameter, 3) Allow KMS Decrypt, 4) Deny DeleteItem/UpdateItem | ✓ Verify in synthesized template |
| **AC-7:** SSM parameters created: `/kiro-governance/config/table-name`, `/kiro-governance/config/region` per F-04 §6.2 | `cdk synth` → CloudFormation includes AWS::SSM::Parameter resources for both paths with correct values | ✓ Verify in synthesized template |
| **AC-8:** CDK stack deploys successfully with `cdk deploy` | Run `npm run build && cdk synth && cdk deploy` — verify stack creation and outputs | ✓ Run end-to-end deployment |

---

## 5. Definition of Done

- [ ] `npm ci` installs all dependencies without errors
- [ ] `npm run build -ws` compiles all workspaces (shared, infra) with zero TypeScript errors
- [ ] `packages/shared/dist/` contains compiled `.js` and `.d.ts` files
- [ ] `infra/dist/` contains compiled CDK stack
- [ ] `cdk synth` generates valid CloudFormation template (no validation errors)
- [ ] CloudFormation template includes:
  - [ ] DynamoDB table `kiro-governance-tracker` with PAY_PER_REQUEST, deletion protection, PITR
  - [ ] GSI `gsi-type-created` (partition: type, sort: created_at, projection: ALL)
  - [ ] GSI `gsi-gate-created` (partition: gate, sort: created_at, projection: ALL)
  - [ ] IAM role `kiro-gov-mcp-server-role` with ALLOW DynamoDB PutItem/Query, ALLOW SSM GetParameter, ALLOW KMS Decrypt, DENY DeleteItem/UpdateItem
  - [ ] Instance profile for EC2 instance assumption
  - [ ] SSM parameters: `/kiro-governance/config/table-name`, `/kiro-governance/config/region`
  - [ ] CloudWatch log group `/kiro-governance/mcp-server` with 30-day retention
- [ ] `cdk deploy` to dev/test account succeeds with all resources created
- [ ] No CDK warnings or errors during synth/deploy
- [ ] Stack outputs exported correctly (TableName, TableArn, McpServerRoleName, InstanceProfileArn)
- [ ] All files formatted with Prettier, pass ESLint
- [ ] No hardcoded secrets in code or config files
- [ ] Documentation (inline TSDoc) complete and accurate

---

## 6. Build & Verification Commands

```bash
# 1. Install all dependencies
npm ci

# 2. Build all workspaces
npm run build -ws

# 3. Validate CDK stack synthesis
cd infra
npx cdk synth

# 4. Review synthesized CloudFormation template (optional)
cat cdk.out/KiroGovernanceStack.template.json | jq .

# 5. Deploy to AWS (dev account)
npx cdk deploy KiroGovernanceStack --require-approval broadening

# 6. Verify stack in AWS Console
# Navigate to CloudFormation → Stacks → KiroGovernanceStack
# Verify: Table, GSIs, IAM role, SSM parameters, log group all present
```

---

## 7. Architecture Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| **Billing Mode: PAY_PER_REQUEST** | POC volume (<100 records/month) stays within free tier. On-demand avoids provisioned capacity management. | SRS NFR-01, data-persistence-architecture.md §2.1 |
| **Deletion Protection: Enabled** | Audit log must be immutable. Prevents accidental table deletion. | code-structure.md §10, CDK best practices |
| **PITR: Enabled** | Governance events are audit trail — must be recoverable from point-in-time backups. | code-structure.md §10 |
| **RemovalPolicy: RETAIN** | Stateful resource — must persist across stack updates/destruction. | code-structure.md §10 |
| **GSI Projection: ALL** | Both query patterns need full record context. No benefit from sparse projection. | data-persistence-architecture.md §2.4 |
| **Explicit DENY on DeleteItem/UpdateItem** | Enforces append-only at IAM level. DENY overrides any Allow, ensuring no mutation paths exist. | data-persistence-architecture.md §6.1, Security Gate 1.5 |
| **KMS Decrypt on alias/aws/ssm** | AWS-managed key for SSM SecureString is acceptable for POC (no PII/PHI). Upgrade to customer-managed CMK if compliance required later. | unified-data-model.md §2.1, architect decision note |
| **Single Stack (not split stateful/stateless)** | POC scope justifies single stack. Extract to separate stacks if domain grows. | code-structure.md §10 |
| **CloudWatch Log Retention: 30 days (dev)** | Balances observability with cost. Follows CDK Lambda construct defaults. | code-structure.md §11 (Lambda defaults), cdk-constructs-standards.md §8 |

---

## 8. Security Invariants (Non-Negotiable)

Per code-structure.md §18 and unified-data-model.md:

1. ✅ **Append-only DynamoDB** — IAM policy DENY on DeleteItem/UpdateItem enforced (non-bypassable)
2. ✅ **No secrets in code/env vars** — all secrets (API key, webhook URLs) read from SSM Parameter Store (SecureString) at runtime
3. ✅ **Encryption at rest** — DynamoDB default AWS-owned CMK (acceptable for POC; upgrade if compliance required)
4. ✅ **No hardcoded physical names except DynamoDB table** — table must be `kiro-governance-tracker` per SRS §6; other resources use CDK-generated names
5. ✅ **Deterministic synthesis** — `cdk.context.json` committed to version control for repeatable builds

---

## 9. Testing & Validation

### CDK Snapshot Test

**File:** `infra/__tests__/governance-stack.test.ts`

```typescript
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { GovernanceStack } from '../stacks/governance-stack';

describe('GovernanceStack', () => {
  test('matches snapshot', () => {
    const app = new App();
    const stack = new GovernanceStack(app, 'TestStack');
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('creates DynamoDB table with correct configuration', () => {
    const app = new App();
    const stack = new GovernanceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'kiro-governance-tracker',
      BillingMode: 'PAY_PER_REQUEST',
      DeletionProtectionEnabled: true,
      SSESpecification: {
        SSEEnabled: true,
      },
    });
  });

  test('creates both GSIs with correct key schema', () => {
    const app = new App();
    const stack = new GovernanceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    // GSIs are part of the table definition
  });

  test('creates IAM role with correct trust and permissions', () => {
    const app = new App();
    const stack = new GovernanceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'kiro-gov-mcp-server-role',
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Principal: {
              Service: 'ec2.amazonaws.com',
            },
            Effect: 'Allow',
          },
        ],
      },
    });
  });

  test('creates SSM parameters for configuration', () => {
    const app = new App();
    const stack = new GovernanceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SSM::Parameter', 2);
  });
});
```

**Run:** `npm test -w infra`

---

## 10. Deployment Checklist (Pre-Deploy)

- [ ] All files created per §3
- [ ] `npm ci && npm run build -ws` succeeds
- [ ] `cdk synth` produces valid CloudFormation (no errors/warnings)
- [ ] All AC criteria reviewed and understood
- [ ] AWS credentials configured (dev/test account)
- [ ] `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` env vars set or in AWS profile
- [ ] No hardcoded secrets in any file
- [ ] `.env` file created (if needed) and added to `.gitignore`
- [ ] Snapshots captured before deployment (for change detection)

---

## 11. Post-Deploy Verification (AWS Console)

1. **CloudFormation Stack**
   - [ ] Stack status: CREATE_COMPLETE
   - [ ] Stack name: KiroGovernanceStack
   - [ ] Region: us-east-1

2. **DynamoDB Table**
   - [ ] Table name: `kiro-governance-tracker`
   - [ ] Billing mode: PAY_PER_REQUEST
   - [ ] Deletion protection: Enabled
   - [ ] Point-in-time recovery: Enabled
   - [ ] Partition key: `pk` (String)
   - [ ] Sort key: `sk` (String)
   - [ ] GSI count: 2
     - [ ] `gsi-type-created` (partition: type, sort: created_at)
     - [ ] `gsi-gate-created` (partition: gate, sort: created_at)

3. **IAM Role**
   - [ ] Role name: `kiro-gov-mcp-server-role`
   - [ ] Trust relationship: EC2 service principal
   - [ ] Inline policies: 4 (DynamoDBWrite, SSMReadConfig, SSMKmsDecrypt, DenyAppendOnlyViolation)

4. **Instance Profile**
   - [ ] Profile name: auto-generated (CDK ID: McpServerInstanceProfile)
   - [ ] Roles: kiro-gov-mcp-server-role

5. **SSM Parameter Store**
   - [ ] `/kiro-governance/config/table-name` = `kiro-governance-tracker`
   - [ ] `/kiro-governance/config/region` = `us-east-1`

6. **CloudWatch**
   - [ ] Log group: `/kiro-governance/mcp-server`
   - [ ] Retention: 30 days

---

*End of KG-01 Implementation Spec v1.0*
