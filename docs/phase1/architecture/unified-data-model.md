# Unified Data Model — `kiro_governance`

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.3 | AWS Architect | CR 2026-06-11: Removed S3 Athena buckets. Data stores: DynamoDB + SSM only. |
| 2026-06-11 | v1.2 | AWS Architect | Fixed DENY statement DynamoDB ARN: kiro-governance-events → kiro-governance-tracker (Security Gate 1.5 final pass) |
| 2026-06-11 | v1.1 | AWS Architect | Security Gate 1.5 fixes: AWS-owned CMK rationale (MED-1), SSM KMS Decrypt scope (MED-2), IAM append-only DENY (LOW-4), S3 SSE-S3 rationale (LOW-5) |
| 2026-06-11 | v1.0 | AWS Architect | Initial unified data model consolidating SRS §7, F-04 v1.3, F-01 v1.2, F-05 v1.0 |

---

## 1. Overview

The `kiro_governance` system uses two data stores:

| Store | Service | Purpose | Owner Domain |
|-------|---------|---------|--------------|
| Governance Event Store | DynamoDB (`kiro-governance-tracker`) | Append-only audit log of macro/micro governance events per project | F-04 (Data & Persistence) |
| Configuration Store | AWS SSM Parameter Store | Runtime config and secrets (webhook URLs, API key, table name) | F-01 (MCP Server Core) |

No relational database. No cache layer. Single-table DynamoDB design.

---

## 2. DynamoDB — `kiro-governance-tracker` Table

### 2.1 Table Configuration

| Property | Value |
|----------|-------|
| Table name | `kiro-governance-tracker` |
| Billing mode | PAY_PER_REQUEST (on-demand) |
| Region | `us-east-1` |
| Encryption | AWS-owned CMK (default) |
| Deletion protection | Enabled |
| Point-in-time recovery | Enabled |
| TTL | None (append-only audit log) |

> `Architect decision — not customer-specified:` AWS-owned CMK is acceptable for this POC (no PII/PHI, no compliance framework required). Upgrade to AWS Managed Key (aws/dynamodb) or customer-managed CMK if compliance requirements are added later.

**IAM-Enforced Append-Only (Explicit DENY):**

```json
{
  "Effect": "Deny",
  "Action": ["dynamodb:DeleteItem", "dynamodb:UpdateItem"],
  "Resource": "arn:aws:dynamodb:<region>:<account>:table/kiro-governance-tracker"
}
```

> `Architect decision — not customer-specified:` Explicit Deny on DeleteItem and UpdateItem enforces append-only at IAM level, making audit log immutability verifiable. DENY overrides any Allow, including from AWS-managed policies.

### 2.2 Key Schema

| Key | Attribute | Type | Format | Example |
|-----|-----------|------|--------|---------|
| Partition Key (PK) | `pk` | String | `PROJECT#<project_id>` | `PROJECT#rainn` |
| Sort Key (SK) | `sk` | String | `UPDATE#<ISO-8601>#<ULID>` or `DEDUP#<idempotency_key>` | `UPDATE#2026-06-10T19:55:00.000Z#01J5K3M2N4P5Q6R7S8T9` |

### 2.3 Full Attribute Table

| Attribute | DynamoDB Type | Required | Description | Example | Populated By |
|-----------|--------------|----------|-------------|---------|-------------|
| `pk` | S (String) | Yes | Partition key — `PROJECT#<github_repo_name>` | `PROJECT#rainn` | FR-02 (MCP write tool) |
| `sk` | S (String) | Yes | Sort key — event: `UPDATE#<ISO>#<ULID>`, dedup: `DEDUP#<key>` | `UPDATE#2026-06-11T10:30:00.000Z#01J5K3M2N4P5Q6R7S8T9` | FR-02 |
| `update_text` | S (String) | Yes | Human-readable governance event description (max 4096 chars) | `"SRS approved by human"` | FR-02, FR-04 (GitHub Actions) |
| `type` | S (String) | Yes | Event classification: `macro` \| `micro` | `"macro"` | FR-03 (auto-classification) |
| `flag_override` | BOOL | No | `true` if `type` was manually set; absent if auto-classified | `true` | FR-03 (manual override) |
| `gate` | S (String) | No | Canonical macro gate name. Present for macro events, absent for micro. | `"SRS approved"` | FR-02, FR-03 (auto-derived) |
| `phase` | S (String) | No | Phase grouping for dashboard | `"Phase 1"` | FR-02 (caller-supplied) |
| `source_ref` | S (String) | Yes | Provenance — commit SHA or file line reference | `"abc123"` / `"project-progress.md#L42"` | FR-02 |
| `actor` | S (String) | Yes | Who emitted/approved — agent name or human name | `"aws-architect"` / `"tariq.khan"` | FR-02 |
| `created_at` | S (String) | Yes | ISO-8601 creation timestamp | `"2026-06-11T10:30:00.000Z"` | FR-02 (server-generated) |
| `idempotency_key` | S (String) | Yes | Dedup key for FR-09 | `"rainn#SRS approved#2026-06-11"` | FR-09 (computed) |

### 2.4 Global Secondary Indexes

#### GSI-1: `gsi-type-created`

| Property | Value |
|----------|-------|
| Partition Key | `type` (String) — `"macro"` or `"micro"` |
| Sort Key | `created_at` (String) — ISO-8601 |
| Projection | ALL |
| Purpose | Cross-project queries by event type (FR-08 rollup) |
| Used By | External consumers querying all macro events across projects |

#### GSI-2: `gsi-gate-created`

| Property | Value |
|----------|-------|
| Partition Key | `gate` (String) — canonical gate name |
| Sort Key | `created_at` (String) — ISO-8601 |
| Projection | ALL |
| Purpose | Cross-project queries by gate (FR-08 filter by gate) |
| Used By | External consumers querying events by specific gate |

> Note: Micro events (where `gate` is absent) are excluded from `gsi-gate-created`. DEDUP sentinel records (where `gate` is absent) are also excluded. This is intentional.

### 2.5 Access Patterns

| # | Pattern | Operation | Key Condition | Filter | Used By |
|---|---------|-----------|---------------|--------|---------|
| 1 | Write governance event | PutItem | `pk`=`PROJECT#<id>`, `sk`=`UPDATE#<ts>#<ulid>` | — | FR-02 (MCP write tool) |
| 2 | All events for a project (timeline) | Query (base table) | `pk`=`PROJECT#<id>` | — | FR-08 (per-project timeline) |
| 3 | All macro events across projects | Query (`gsi-type-created`) | `type`=`"macro"` | — | FR-08 (cross-project rollup) |
| 4 | Events by gate across projects | Query (`gsi-gate-created`) | `gate`=`"<gate_name>"` | — | FR-08 (filter by gate) |
| 5 | Deduplication sentinel write | Conditional PutItem | `pk`=`PROJECT#<id>`, `sk`=`DEDUP#<key>`, condition `attribute_not_exists(pk)` | — | FR-09 (idempotency) |
| 6 | Project events filtered by type | Query (base table) | `pk`=`PROJECT#<id>` | `type`=`"macro"` or `"micro"` | FR-08 (per-project + type filter) |
| 7 | Project events in time range | Query (base table) | `pk`=`PROJECT#<id>`, `sk` BETWEEN `UPDATE#<start>` AND `UPDATE#<end>` | — | FR-08 (date range) |

### 2.6 Canonical TypeScript Type — `GovernanceEventRecord`

This is the **single source of truth**. F-01 and F-04 must import from this definition.

**Location:** `packages/shared/types/governance-event.ts`

```typescript
/**
 * DynamoDB record shape for kiro-governance-tracker table.
 * Canonical definition — unified data model v1.0.
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

### 2.7 Dedup Sentinel Record Shape

DEDUP records share the same table but are **not** governance events — they are control records.

| Attribute | Value | Notes |
|-----------|-------|-------|
| `pk` | `PROJECT#<project_id>` | Same partition as events |
| `sk` | `DEDUP#<idempotency_key>` | Prefixed to separate from UPDATE records |
| `created_at` | ISO-8601 | When first trigger wrote the sentinel |
| `idempotency_key` | e.g. `rainn#SRS approved#2026-06-11` | Redundant for query convenience |

---

## 3. SSM Parameter Store

| Path | Type | Owner Domain | Description | Example Value |
|------|------|-------------|-------------|---------------|
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | F-01 (MCP Server) | Slack incoming webhook URL per project | `https://hooks.slack.com/services/T.../B.../xxx` |
| `/kiro-governance/config/mcp-api-key` | SecureString | F-01 (MCP Server) | Shared API key for GitHub Actions → MCP auth | `sk-gov-xxxxxxxxxxxx` |
| `/kiro-governance/config/table-name` | String | F-04 (Data) | DynamoDB table name | `kiro-governance-tracker` |
| `/kiro-governance/config/region` | String | F-04 (Data) | AWS region for SDK clients | `us-east-1` |

**Naming convention:** `/kiro-governance/{category}/{key}`

- `/kiro-governance/slack/webhooks/*` — per-project webhook URLs (dynamic, one per project)
- `/kiro-governance/config/*` — static server configuration

**Access pattern:** F-01 reads all paths at startup (config) and per-request with 5-min TTL cache (webhooks). No other domain writes to SSM at runtime.

**KMS Decrypt scope for SSM SecureString parameters:**

```json
{
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:<region>:<account>:key/alias/aws/ssm"
}
```

> `Architect decision — not customer-specified:` kms:Decrypt scoped to aws/ssm alias (the AWS-managed key used by SSM Parameter Store SecureString parameters). Replace with customer-managed CMK ARN if using a custom key.

---

## 4. PII & Sensitive Data Inventory

| Field | Contains PII? | Contains Secrets? | Sensitivity | Notes |
|-------|--------------|-------------------|-------------|-------|
| `pk` | No | No | Low | Project identifier (GitHub repo name) |
| `sk` | No | No | Low | Timestamp + ULID or dedup key |
| `update_text` | **Possible** | No | Low–Medium | Free-text from `project-progress.md`. May contain project names, feature names, internal terminology. No customer PII. |
| `type` | No | No | Low | Enum: `macro`/`micro` |
| `flag_override` | No | No | Low | Boolean |
| `gate` | No | No | Low | Canonical gate name |
| `phase` | No | No | Low | Phase label |
| `source_ref` | No | No | Low | Commit SHA / file reference |
| `actor` | **Possible** | No | Low–Medium | May contain human names/usernames (e.g., `tariq.khan`) or agent names (e.g., `aws-architect`). Internal team identifiers only — no external customer PII. |
| `created_at` | No | No | Low | Timestamp |
| `idempotency_key` | No | No | Low | Composite of project + gate + date |

### Classification

| Category | Assessment |
|----------|-----------|
| PII | Minimal — `actor` may contain internal team member names/usernames. No customer/end-user PII. |
| PHI | None |
| Secrets | None stored in DynamoDB. Secrets live in SSM SecureString only. |
| Compliance framework | None required — internal developer tooling POC |
| Data residency | `us-east-1` only. No cross-region replication. |
| Encryption at rest | AWS-owned CMK (DynamoDB default). Acceptable for non-PII/non-PHI internal data. |

> `Architect decision:` No compliance framework (HIPAA, PCI-DSS, GDPR, SOC2) applies to this system. It is internal tooling tracking agent-generated artifact governance. No external user data is stored.

---

## 5. Data Retention

| Store | Retention Policy | Mechanism | Justification |
|-------|-----------------|-----------|---------------|
| DynamoDB (`kiro-governance-tracker`) | **Indefinite** — no TTL, no expiry | Append-only writes; deletion protection enabled; PITR enabled | `Architect decision:` This table is an audit log. Governance events must be retained for historical reporting and traceability. At POC volume (<100 records/month), storage cost is negligible (~$0.00025/month per 1000 items). |
| SSM Parameter Store | **Indefinite** | Manual management | Config/secrets persist until explicitly rotated or deleted by admin. |

---

## 6. Cross-Document Consistency Check (H2)

### Field Names

| Field | SRS §7 | F-04 §2.3 | F-01 §10 | Status |
|-------|--------|-----------|----------|--------|
| `pk` | `PK` (uppercase) | `pk` (lowercase) | `pk` | ⚠️ SRS uses uppercase `PK` as a label; actual DynamoDB attribute is lowercase `pk`. No functional issue — SRS §7 is a reference table, not code. |
| `sk` | `SK` (uppercase) | `sk` | `sk` | ⚠️ Same as above — cosmetic only. |
| `update_text` | `update_text` | `update_text` | `update_text` | ✅ Consistent |
| `type` | `type` | `type` | `type` | ✅ Consistent |
| `flag_override` | `flag_override` | `flag_override` | `flag_override` | ✅ Consistent |
| `gate` | `gate` | `gate` | `gate` | ✅ Consistent |
| `phase` | `phase` | `phase` | `phase` | ✅ Consistent |
| `source_ref` | `source_ref` | `source_ref` | `source_ref` | ✅ Consistent |
| `actor` | `actor` | `actor` | `actor` | ✅ Consistent |
| `created_at` | `created_at` | `created_at` | `created_at` | ✅ Consistent |
| `idempotency_key` | — (FR-09 text) | `idempotency_key` | `idempotency_key` | ✅ Consistent (not in SRS §7 table but defined in FR-09) |

### GSI Names

| GSI | F-04 §2.4 | Status |
|-----|-----------|--------|
| `gsi-type-created` | `gsi-type-created` | ✅ Consistent |
| `gsi-gate-created` | `gsi-gate-created` | ✅ Consistent |

### Table Name

| Document | Value | Status |
|----------|-------|--------|
| SRS §6 | `kiro-governance-tracker` (implied via "Project Tracker DB") | ✅ |
| F-04 §2.1 | `kiro-governance-tracker` | ✅ |
| F-01 §12 (H2) | `kiro-governance-tracker` | ✅ |

### TypeScript Type

| Document | Type Name | Match |
|----------|-----------|-------|
| F-04 §2.5 | `GovernanceEventRecord` | ✅ Canonical definition |
| F-01 §10 | Re-exports from `../shared/types/governance-event` | ✅ References F-04 |
| This doc §2.6 | `GovernanceEventRecord` | ✅ Authoritative |

### Discrepancies Found

| # | Issue | Severity | Resolution |
|---|-------|----------|-----------|
| 1 | SRS §7 uses uppercase `PK`/`SK` as labels; F-04/F-01 use lowercase `pk`/`sk` as DynamoDB attribute names | Info | No action needed. SRS §7 is a conceptual reference table. The actual attribute names are lowercase as defined in F-04 and used in code. |

**Result: All field names, types, GSI names, and table names are consistent across F-01 and F-04. No functional discrepancies.**

---

*End of Unified Data Model v1.3*
