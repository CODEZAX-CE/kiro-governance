# Data & Persistence Architecture — F-04: DynamoDB Table

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.7 | AWS Architect | CR 2026-06-11: Removed Athena connector, S3 Athena buckets, QuickSight IAM role. F-04 scope is now DynamoDB table + IAM + SSM only. |
| 2026-06-11 | v1.6 | AWS Architect | SEC-1 (Security Gate 2): Added explicit DENY on dynamodb:DeleteItem/UpdateItem to CDK stack to match IAM JSON policy in §6.1. |
| 2026-06-11 | v1.5 | AWS Architect | Fixed DENY statement DynamoDB ARN: kiro-governance-events → kiro-governance-tracker (Security Gate 1.5 final pass) |
| 2026-06-11 | v1.4 | AWS Architect | Security Gate 1.5 fixes: SSM KMS Decrypt scope (MED-2), IAM Deny DeleteItem/UpdateItem (LOW-4), DynamoDB CMK note (MED-1) |
| 2026-06-11 | v1.3 | AWS Architect | Security Gate 1 fixes: removed unused GitHub Actions DynamoDB role (MED-4), encryption at rest note (LOW-7). |
| 2026-06-11 | v1.2 | AWS Architect | Fixed Athena data catalog name typo in CLI command: kiro-governance-dynamodb → kiro_gov_ddb (H2 audit finding). |
| 2026-06-11 | v1.1 | AWS Architect | Fixed SAR CLI syntax (FINDING-1), aligned IAM SSM scope (FINDING-2), added Athena data catalog registration step (FINDING-3), corrected access pattern 5 description (FINDING-4), documented GSI micro-event exclusion (FINDING-5). |
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-04 from SRS v1.5 |

---

## 1. Overview

**Domain:** Data & Persistence
**Feature:** F-04 — DynamoDB Table
**Purpose:** Provide the append-only governance event store that FR-02 writes to.

**SRS References:**
- **FR-02** (write target) — MCP Server DynamoDB Write Tool writes records here
- **FR-09** (idempotency) — deduplication key stored and checked in this table
- **SRS §7** — Data model schema definition

**This domain owns no FR directly** — it is shared infrastructure. F-01 (MCP Server Core) owns FR-02 write logic. This domain owns the table, GSIs, and IAM roles.

---

## 2. DynamoDB Table Design

### 2.1 Table Configuration

| Property | Value | Source |
|----------|-------|--------|
| Table name | `kiro-governance-tracker` | SRS §6, Domain Decomposition §4 |
| Billing mode | PAY_PER_REQUEST (on-demand) | SRS NFR-01: "on-demand capacity" |
| Region | `us-east-1` | `Architect decision — not customer-specified` |
| Encryption | AWS-owned CMK (default) | `Architect decision — not customer-specified` |
| Deletion protection | Enabled | `Architect decision — not customer-specified` |
| Point-in-time recovery | Enabled | `Architect decision — not customer-specified` |
| TTL | None (append-only audit log, no expiry) | `Architect decision — not customer-specified` |

> `Architect decision — not customer-specified:` AWS-owned key encryption is acceptable for POC. No PII/PHI in governance records. Upgrade to customer-managed CMK if compliance is required later.

> `Architect decision — not customer-specified:` AWS-owned CMK is acceptable for this POC (no PII/PHI, no compliance framework required). Upgrade to AWS Managed Key (aws/dynamodb) or customer-managed CMK if compliance requirements are added later.

### 2.2 Key Schema

| Key | Attribute | Type | Example |
|-----|-----------|------|---------|
| Partition Key (PK) | `pk` | String | `PROJECT#rainn` |
| Sort Key (SK) | `sk` | String | `UPDATE#2026-06-10T19:55:00.000Z#01J5K3M2N4P5Q6R7S8T9` |

**SK format:** `UPDATE#<ISO-8601-timestamp>#<ULID>`
- Timestamp provides chronological sort order
- ULID suffix guarantees uniqueness for events at the same millisecond

> Source: SRS §7 — "PK: `PROJECT#rainn`", "SK: `UPDATE#2026-06-10T19:55Z#<ulid>`"

### 2.3 Complete Attribute Definitions

| Attribute | DynamoDB Type | Required | Description | Source |
|-----------|--------------|----------|-------------|--------|
| `pk` | S (String) | Yes | `PROJECT#<project_id>` — partition by project | SRS §7 |
| `sk` | S (String) | Yes | `UPDATE#<ISO-timestamp>#<ULID>` — sort by time | SRS §7 |
| `update_text` | S (String) | Yes | Human-readable description of the governance event | SRS §7 |
| `type` | S (String) | Yes | `macro` \| `micro` — event classification | SRS §7 |
| `flag_override` | BOOL (Boolean) | No | `true` if type was manually overridden; absent if auto-classified | SRS §7, FR-03 |
| `gate` | S (String) | No | Canonical macro gate name (e.g., "SRS Approval"). Required for macro events, absent for micro. | SRS §7 |
| `phase` | S (String) | No | Phase grouping (e.g., "Phase 1"). Optional. | SRS §7 |
| `source_ref` | S (String) | Yes | Provenance — commit SHA or file line ref | SRS §7 |
| `actor` | S (String) | Yes | Who emitted/approved (agent name or human name) | SRS §7 |
| `created_at` | S (String) | Yes | ISO-8601 timestamp of record creation | SRS §7 |
| `idempotency_key` | S (String) | Yes | Dedup key: `<project_id>#<gate>#<YYYY-MM-DD>` for macro; `<project_id>#micro#<ULID>` for micro | SRS FR-09 |

### 2.4 GSI Definition

**GSI Name:** `gsi-type-created`

| Property | Value |
|----------|-------|
| Partition Key | `type` (String) — `macro` or `micro` |
| Sort Key | `created_at` (String) — ISO timestamp |
| Projection | ALL (all attributes projected) |
| Billing | Inherits PAY_PER_REQUEST from base table |

**Purpose:** Enables cross-project queries — "show all macro events across all projects sorted by time" (FR-08 dashboard rollup).

> Source: SRS §7 — "GSI: On `type` (or `gate`) to support dashboard cross-project rollups."

**GSI Name:** `gsi-gate-created`

| Property | Value |
|----------|-------|
| Partition Key | `gate` (String) — canonical gate name |
| Sort Key | `created_at` (String) — ISO timestamp |
| Projection | ALL |
| Billing | Inherits PAY_PER_REQUEST |

**Purpose:** Enables "show all events for a specific gate across projects" (FR-08 filter by gate).

> `Architect decision — not customer-specified:` Micro events (where `gate` attribute is absent) are not projected into this GSI and are excluded from gate-based dashboard queries. This is intentional.

> `Architect decision — not customer-specified:` SRS §7 says "GSI on `type` (or `gate`)" — providing both GSIs since both access patterns are needed for the dashboard (FR-08 ACs: filter by type AND filter by gate).

### 2.5 TypeScript Record Type

```typescript
/**
 * DynamoDB record shape for kiro-governance-tracker table.
 * See docs/phase1/data-persistence-architecture.md §2.3
 */
export interface GovernanceEventRecord {
  /** Partition key: PROJECT#<project_id> */
  pk: string;
  /** Sort key: UPDATE#<ISO-timestamp>#<ULID> */
  sk: string;
  /** Human-readable event description */
  update_text: string;
  /** Event classification */
  type: 'macro' | 'micro';
  /** True if type was manually overridden; undefined if auto-classified */
  flag_override?: boolean;
  /** Canonical macro gate name. Required for macro, absent for micro. */
  gate?: string;
  /** Phase grouping (e.g., "Phase 1") */
  phase?: string;
  /** Provenance — commit SHA or file line reference */
  source_ref: string;
  /** Who emitted/approved */
  actor: string;
  /** ISO-8601 creation timestamp */
  created_at: string;
  /** Deduplication key */
  idempotency_key: string;
}

/** Valid macro gate names (from SRS §16) */
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
```

---

## 3. Access Patterns

| # | Pattern | Query Type | Key Condition | Filter | Used By |
|---|---------|-----------|---------------|--------|---------|
| 1 | Write a single governance event | PutItem | `pk` = `PROJECT#<id>`, `sk` = `UPDATE#<ts>#<ulid>` | — | FR-02 (MCP Server write tool) |
| 2 | Read all events for a project (timeline) | Query on base table | `pk = PROJECT#<project_id>` | — | FR-08 (per-project timeline) |
| 3 | Read all macro events across projects | Query on `gsi-type-created` | `type = "macro"` | — | FR-08 (cross-project rollup) |
| 4 | Read events by gate across projects | Query on `gsi-gate-created` | `gate = "<gate_name>"` | — | FR-08 (filter by gate) |
| 5 | Deduplication check | Conditional PutItem on base table | `pk` = `PROJECT#<project_id>`, `sk` = `DEDUP#<idempotency_key>` with `attribute_not_exists(pk)` | — | FR-09 (idempotency) |
| 6 | Read events for project filtered by type | Query on base table | `pk = PROJECT#<project_id>` | `type = "macro"` or `type = "micro"` | FR-08 (per-project + type filter) |
| 7 | Read events for project in time range | Query on base table | `pk = PROJECT#<id>`, `sk BETWEEN UPDATE#<start> AND UPDATE#<end>` | — | FR-08 (date range filter) |

### Pattern 5 — Deduplication Detail

The idempotency check (Pattern 5) uses a **conditional PutItem** rather than a query-then-write pattern. See §4 for full implementation.

---

## 4. Idempotency Key Design

> Source: SRS FR-09 — "Deduplication uses an idempotency key composed of: PK (PROJECT#<project_id>) + gate name + day-granularity date (YYYY-MM-DD)."

### 4.1 Key Format

```
Macro events:  <project_id>#<gate>#<YYYY-MM-DD>
Micro events:  <project_id>#micro#<ULID>
```

**Examples:**
- `rainn#SRS approved#2026-06-11` — macro event
- `rainn#micro#01J5K3M2N4P5Q6R7S8T9` — micro event (always unique, no dedup needed)

### 4.2 Implementation Pattern

Deduplication uses a **conditional PutItem** with a condition expression that rejects the write if the `idempotency_key` already exists in any record for that partition.

**Problem:** DynamoDB conditional expressions only apply to the item being written (same PK+SK). We cannot condition on another item's attributes.

**Solution:** Use a **dedicated dedup record** pattern:

1. Before writing the event record, attempt a **PutItem** for a dedup sentinel record:
   - `pk` = `PROJECT#<project_id>`
   - `sk` = `DEDUP#<idempotency_key>`
   - `created_at` = current timestamp
   - Condition: `attribute_not_exists(pk)` (fails if sentinel already exists)

2. If the sentinel PutItem **succeeds** → proceed to write the actual event record (Pattern 1).
3. If the sentinel PutItem **fails** with `ConditionalCheckFailedException` → event is a duplicate, skip both the DynamoDB event write and Slack notification.

**For micro events:** The ULID in the idempotency key guarantees uniqueness — no dedup sentinel is needed. Write directly.

### 4.3 TypeScript Implementation

```typescript
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const TABLE_NAME = 'kiro-governance-tracker';

interface WriteEventInput {
  project_id: string;
  update_text: string;
  type: 'macro' | 'micro';
  gate?: string;
  phase?: string;
  source_ref: string;
  actor: string;
  flag_override?: boolean;
}

/**
 * Build idempotency key per FR-09 spec.
 */
function buildIdempotencyKey(input: WriteEventInput, ulid: string): string {
  if (input.type === 'macro' && input.gate) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${input.project_id}#${input.gate}#${today}`;
  }
  return `${input.project_id}#micro#${ulid}`;
}

/**
 * Attempt to write governance event with deduplication.
 * Returns { written: true, pk, sk } on success, { written: false, reason: 'duplicate' } on dedup hit.
 */
async function writeGovernanceEvent(
  client: DynamoDBClient,
  input: WriteEventInput,
  ulid: string,
): Promise<{ written: boolean; pk?: string; sk?: string; reason?: string }> {
  const pk = `PROJECT#${input.project_id}`;
  const now = new Date().toISOString();
  const idempotencyKey = buildIdempotencyKey(input, ulid);

  // Step 1: For macro events, attempt dedup sentinel write
  if (input.type === 'macro') {
    try {
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          pk,
          sk: `DEDUP#${idempotencyKey}`,
          created_at: now,
          idempotency_key: idempotencyKey,
        }),
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return { written: false, reason: 'duplicate' };
      }
      throw err;
    }
  }

  // Step 2: Write actual event record
  const sk = `UPDATE#${now}#${ulid}`;
  const item: Record<string, unknown> = {
    pk,
    sk,
    update_text: input.update_text,
    type: input.type,
    source_ref: input.source_ref,
    actor: input.actor,
    created_at: now,
    idempotency_key: idempotencyKey,
  };
  if (input.gate) item.gate = input.gate;
  if (input.phase) item.phase = input.phase;
  if (input.flag_override !== undefined) item.flag_override = input.flag_override;

  await client.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(item),
  }));

  return { written: true, pk, sk };
}
```

### 4.4 Dedup Sentinel Record Shape

| Attribute | Value | Purpose |
|-----------|-------|---------|
| `pk` | `PROJECT#<project_id>` | Same partition as events |
| `sk` | `DEDUP#<idempotency_key>` | Unique sentinel per dedup scope |
| `created_at` | ISO timestamp | When first trigger wrote it |
| `idempotency_key` | Same as the key value | For query convenience |

**Note:** Dedup sentinels are never deleted. They are lightweight (~200 bytes each) and serve as a permanent audit trail that deduplication occurred. At 10 macro events per project per month, storage is negligible.

> `Architect decision — not customer-specified:` The dedup sentinel pattern is the architect's chosen mechanism. SRS FR-09 specifies the key composition but not the implementation mechanism.

---

## 6. IAM & Security

### 6.1 IAM Roles

#### Role 1: MCP Server EC2 Instance Role

**Name:** `kiro-gov-mcp-server-role`
**Trust:** EC2 service (`ec2.amazonaws.com`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBWrite",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:<account_id>:table/kiro-governance-tracker",
        "arn:aws:dynamodb:us-east-1:<account_id>:table/kiro-governance-tracker/index/*"
      ]
    },
    {
      "Sid": "SSMReadConfig",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:us-east-1:<account_id>:parameter/kiro-governance/*"
    },
    {
      "Sid": "SSMKmsDecrypt",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:<region>:<account>:key/alias/aws/ssm"
    },
    {
      "Sid": "DenyAppendOnlyViolation",
      "Effect": "Deny",
      "Action": ["dynamodb:DeleteItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account>:table/kiro-governance-tracker"
    }
  ]
}
```

> `Architect decision — not customer-specified:` Query permission needed for dedup sentinel check. No DeleteItem or UpdateItem.

> `Architect decision — not customer-specified:` kms:Decrypt scoped to aws/ssm alias (the AWS-managed key used by SSM Parameter Store SecureString parameters). Replace with customer-managed CMK ARN if using a custom key.

> `Architect decision — not customer-specified:` Explicit Deny on DeleteItem and UpdateItem enforces append-only at IAM level, making audit log immutability verifiable. DENY overrides any Allow, including from AWS-managed policies.

### 6.2 SSM Parameter Store Paths

| Path | Type | Purpose | Source |
|------|------|---------|--------|
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | Slack incoming webhook URL per project | SRS FR-01, OQ-01 resolution |
| `/kiro-governance/config/mcp-api-key` | SecureString | API key for GitHub Actions → MCP server auth | SRS NFR-03, OQ-04 resolution |
| `/kiro-governance/config/table-name` | String | DynamoDB table name | `Architect decision — not customer-specified` |
| `/kiro-governance/config/region` | String | AWS region | `Architect decision — not customer-specified` |

---

## 7. Infrastructure as Code

### 7.1 CDK TypeScript Stack

```typescript
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class DataPersistenceStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;

    // DynamoDB Table
    this.table = new dynamodb.Table(this, 'GovernanceTracker', {
      tableName: 'kiro-governance-tracker',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: true,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI: type + created_at (cross-project rollup by type)
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi-type-created',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: gate + created_at (filter by gate)
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi-gate-created',
      partitionKey: { name: 'gate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // IAM: MCP Server EC2 instance role
    const mcpServerRole = new iam.Role(this, 'McpServerRole', {
      roleName: 'kiro-gov-mcp-server-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    this.table.grant(mcpServerRole, 'dynamodb:PutItem', 'dynamodb:Query');
    mcpServerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${accountId}:parameter/kiro-governance/*`],
    }));

    // Enforce append-only: explicitly deny delete and update at IAM level
    // Architect decision: DENY overrides any Allow, enforcing audit-log immutability per unified-data-model.md §2.1
    mcpServerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['dynamodb:DeleteItem', 'dynamodb:UpdateItem'],
      resources: [this.table.tableArn],
    }));

    // SSM Parameters (placeholder values)
    new ssm.StringParameter(this, 'TableNameParam', {
      parameterName: '/kiro-governance/config/table-name',
      stringValue: this.table.tableName,
    });

    new ssm.StringParameter(this, 'RegionParam', {
      parameterName: '/kiro-governance/config/region',
      stringValue: this.region,
    });
  }
}
```

---

## 8. Edge Cases

### 8.1 DynamoDB Write Failure Handling

| Scenario | Handling | Source |
|----------|----------|--------|
| DynamoDB service unavailable (5xx) | MCP server returns HTTP 500 to caller. Slack notification may have already fired (independent). Caller should retry. | SRS §10: "DynamoDB write fails → Error returned to caller" |
| Provisioned throughput exceeded | N/A — using PAY_PER_REQUEST (on-demand). No throttling at POC scale. | SRS NFR-01 |
| Item size > 400 KB | Not possible — largest field is `update_text` (a single progress entry line). `Architect decision — not customer-specified:` Validate `update_text` ≤ 4 KB at MCP server layer. |
| Network timeout to DynamoDB | Retry with exponential backoff (AWS SDK default: 3 retries). If all retries fail, return 500. | `Architect decision — not customer-specified` |

### 8.2 Idempotency Key Collision

| Scenario | Handling |
|----------|----------|
| Same gate, same day, orchestrator hook fires first | Sentinel `DEDUP#rainn#SRS approved#2026-06-11` is created. GitHub Actions path attempts same sentinel → `ConditionalCheckFailedException` → write skipped, no duplicate Slack. |
| Same gate, same day, GitHub Actions fires first | Same logic — first writer wins, second is rejected. |
| Race condition: both paths write sentinel simultaneously | DynamoDB's conditional write is atomic per item — exactly one will succeed, the other will get `ConditionalCheckFailedException`. No corrupt state possible. |
| Legitimate same-gate event on different days | Different idempotency key (date component differs) → both write successfully. |
| Same gate, same day, different projects | Different PK → different partition → no collision. |

### 8.3 Large `project-progress.md` Diffs

| Scenario | Handling |
|----------|----------|
| Bulk edit adds 10+ lines with macro-gate lingo | GitHub Actions workflow processes each line sequentially. Each macro entry gets its own dedup sentinel. Writes are independent — partial failure does not block remaining writes. |
| Same gate appears multiple times in one diff | Only the first write succeeds (dedup sentinel blocks the rest within the same day). This is correct behavior — a gate should only be marked complete once per day. |
| Very large diff (100+ lines) | GitHub Actions runner has 6-hour timeout — processing 100 lines with HTTP calls to MCP server takes <60s even at 500ms per call. Not a concern. |

---

## 9. Hallucination Gate H2 — Self-Check

| Item | Value | Source |
|------|-------|--------|
| Table name: `kiro-governance-tracker` | `kiro-governance-tracker` | SRS §6, Domain Decomposition §4 |
| PK format: `PROJECT#<project_id>` | `PROJECT#rainn` | SRS §7 |
| SK format: `UPDATE#<timestamp>#<ulid>` | `UPDATE#2026-06-10T19:55Z#<ulid>` | SRS §7 |
| Billing mode: PAY_PER_REQUEST | On-demand | SRS NFR-01 |
| Region: `us-east-1` | — | `Architect decision — not customer-specified` |
| 10 canonical macro gates | Listed in SRS §16 | SRS §16 (Project Brief §4a) |
| project_id = GitHub repository name | e.g., `rainn` | SRS OQ-02 resolution, Customer (Tariq Khan) 2026-06-11 |
| SSM path: `/kiro-governance/slack/webhooks/{project_id}` | — | SRS FR-01, OQ-01+OQ-04 resolution |
| Idempotency key: `PK + gate + YYYY-MM-DD` | — | SRS FR-09 |
| GSI on `type` or `gate` | Both provided | SRS §7: "GSI on `type` (or `gate`)" — architect chose both |
| Deletion protection: enabled | — | `Architect decision — not customer-specified` |
| Point-in-time recovery: enabled | — | `Architect decision — not customer-specified` |
| `update_text` max size: 4 KB | — | `Architect decision — not customer-specified` |
| DynamoDB record TTL: none | — | `Architect decision — not customer-specified` (append-only audit log) |

---

## 10. Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| DynamoDB (on-demand) | ~$0 | Free tier covers <25 WCU/RCU; POC volume is negligible |
| Total F-04 infrastructure | ~$0.00/mo | DynamoDB free tier only |

---

*End of Data & Persistence Architecture v1.7*
