> ⚠️ SUPERSEDED — 2026-06-11: Athena and QuickSight dropped per customer decision (Faraz). This document is no longer in scope. See change request: docs/phase1/change-requests/2026-06-11-drop-athena-quicksight.md

# Reporting Architecture — F-05: QuickSight Dashboard — Cross-Project Status

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-05 from SRS v1.5, F-04 v1.1, domain decomposition v1.0 |

---

## 1. Overview

**Domain:** Reporting
**Feature:** F-05 — QuickSight Dashboard — Cross-Project Status
**Purpose:** Provide cross-project governance visibility via an Amazon QuickSight dashboard that reads from the DynamoDB governance event store through the Athena federated query connector.

**FRs Owned:**

| FR | Title | Summary |
|----|-------|---------|
| FR-08 | Dashboard — Cross-Project Status Reporting | Display per-project governance events and cross-project macro gate rollup with filters |

> Source: SRS §8 FR-08, Project Brief §3 step 7 — "Quick dashboard & reporting reads the DB for cross-project status."

**Dependencies:**

| Dependency | Document | What F-05 Consumes |
|-----------|----------|-------------------|
| F-04 — Data & Persistence | `docs/phase1/data-persistence-architecture.md` v1.1 | Athena DynamoDB connector (`kiro_gov_ddb` catalog), Athena workgroup (`kiro-governance`), S3 results bucket, IAM role (`kiro-gov-quicksight-athena-role`), sample SQL queries (§5.3) |

---

## 2. Data Pipeline (Read Path)

### 2.1 Architecture

```
DynamoDB (kiro-governance-tracker)
    ↓ [Athena DynamoDB Federated Query Connector — Lambda]
Athena (workgroup: kiro-governance, catalog: kiro_gov_ddb)
    ↓ [SQL queries via QuickSight dataset]
QuickSight (dashboard)
```

**Flow:**
1. QuickSight dataset executes SQL queries against the `kiro_gov_ddb` Athena data catalog
2. Athena routes the query to the `kiro-gov-athena-ddb-connector` Lambda function
3. The Lambda connector scans/queries the DynamoDB table and returns result sets
4. QuickSight renders the results in dashboard visuals

### 2.2 Athena Data Source in QuickSight

| Property | Value | Source |
|----------|-------|--------|
| Data source type | Athena | SRS FR-08: "DynamoDB → Athena Federated Query connector → QuickSight" |
| Athena workgroup | `kiro-governance` | F-04 §5.4 |
| Data catalog | `kiro_gov_ddb` | F-04 §5.1 |
| IAM role | `kiro-gov-quicksight-athena-role` | F-04 §6.1 Role 4 |

### 2.3 Dataset Refresh Strategy

> `Architect decision — not customer-specified:` **Direct Query mode** (no SPICE import).

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| SPICE import | Fast dashboard load; cached data; supports large datasets | Requires scheduled refresh; stale data between refreshes; SPICE capacity costs ($0.25/GB/mo); adds complexity for POC | ❌ Rejected |
| **Direct Query** | Always shows latest data; zero SPICE cost; simplest setup; appropriate for POC volume (<1000 records) | Each dashboard load triggers Athena query (~$0.005 per query at POC scale); slower load time (2-5s with connector cold start) | ✅ Selected |

**Justification:** At POC scale (<100 records/month, <5 dashboard users), the cost of direct queries is negligible (~$0.50/mo). Real-time freshness matters more than sub-second load times for a governance status dashboard. SPICE can be added later if query volume grows.

### 2.4 Athena Workgroup

Uses the workgroup defined in F-04 §5.4:

| Property | Value |
|----------|-------|
| Workgroup name | `kiro-governance` |
| Query result location | `s3://kiro-governance-athena-results-<account_id>/` |
| Bytes scanned cutoff | 100 MB |

---

## 3. Dashboard Design

### 3.1 Views (per FR-08 ACs)

**View 1: Per-Project Governance Timeline**

| Requirement | Source |
|-------------|--------|
| List of governance events (macro and micro) sorted by time | SRS FR-08 AC: "Per-project: list of governance events (macro and micro) sorted by time" |

**View 2: Cross-Project Macro Gate Rollup**

| Requirement | Source |
|-------------|--------|
| Rollup of macro gate completions by phase | SRS FR-08 AC: "Cross-project: rollup of macro gate completions by phase" |

**Filters:**

| Filter | Source |
|--------|--------|
| Project | SRS FR-08 AC: "Filter by: project, gate, phase, type (macro/micro)" |
| Gate | SRS FR-08 AC |
| Phase | SRS FR-08 AC |
| Type (macro/micro) | SRS FR-08 AC |

### 3.2 Suggested Visuals

> `Architect decision — not customer-specified:` Visual types selected for clarity and information density at POC scale.

**View 1 — Per-Project Timeline:**

| Visual | Type | Data | Purpose |
|--------|------|------|---------|
| Event table | Table | `created_at`, `update_text`, `type`, `gate`, `actor`, `source_ref` | Full event history, sortable by time (default: descending) |

**View 2 — Cross-Project Rollup:**

| Visual | Type | Data | Purpose |
|--------|------|------|---------|
| Gate completion matrix | Pivot Table | Rows: project (`pk`), Columns: gate names, Values: `completed_at` timestamp | At-a-glance view of which projects have passed which gates |
| Completions by phase | Horizontal Bar Chart | X: count of completed gates, Y: phase, Color: project | Shows phase progress across projects |

### 3.3 Layout Recommendation

> `Architect decision — not customer-specified:`

**Single-page dashboard with two tabs:**

| Tab | Content |
|-----|---------|
| **Project Timeline** | Filter controls (project dropdown, type toggle) at top → Event table below |
| **Cross-Project Status** | Filter controls (phase, gate) at top → Gate completion matrix → Completions by phase bar chart |

---

## 4. QuickSight Setup

### 4.1 Account Type

| Property | Value | Source |
|----------|-------|--------|
| Edition | Standard | `Architect decision — not customer-specified` |
| License type | Author | SRS NFR-05: "$12/mo (Author license)" |
| Cost | $12/month per Author user | SRS NFR-05 |

> `Architect decision — not customer-specified:` Standard edition is sufficient for POC. Enterprise adds row-level security, ML insights, and email reporting — none required at POC stage. Standard Author at $12/mo meets the budget constraint.

### 4.2 Connecting QuickSight to Athena

**Step 1: Configure QuickSight to access Athena**

In QuickSight Console → Manage QuickSight → Security & permissions:
- Enable Amazon Athena access
- Select the IAM role: `kiro-gov-quicksight-athena-role` (F-04 §6.1 Role 4)
- Grant access to the S3 results bucket: `kiro-governance-athena-results-<account_id>`

**Step 2: Create Athena data source**

| Setting | Value |
|---------|-------|
| Data source name | `kiro-governance-dynamodb` |
| Athena workgroup | `kiro-governance` |
| Data catalog | `kiro_gov_ddb` |

**Step 3: Create dataset**

| Setting | Value |
|---------|-------|
| Dataset name | `governance-events` |
| Data source | `kiro-governance-dynamodb` |
| Query mode | Direct Query |
| Custom SQL | See §5 below |

### 4.3 IAM Role

Uses `kiro-gov-quicksight-athena-role` as defined in F-04 §6.1 Role 4:

| Permission | Resource | Purpose |
|-----------|----------|---------|
| `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`, `athena:StopQueryExecution` | `arn:aws:athena:us-east-1:<account_id>:workgroup/kiro-governance` | Execute and read Athena queries |
| `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:GetBucketLocation` | `arn:aws:s3:::kiro-governance-athena-results-<account_id>/*` | Store/read query results |
| `lambda:InvokeFunction` | `arn:aws:lambda:us-east-1:<account_id>:function:kiro-gov-athena-ddb-connector` | Invoke the DynamoDB federated connector |

---

## 5. Athena Queries for Dashboard

All queries reference the F-04 §5.3 sample queries. Table: `"kiro_gov_ddb"."default"."kiro-governance-tracker"`.

### 5.1 Per-Project Timeline (View 1)

Reuses F-04 §5.3 Query 1 — all events for a specific project:

```sql
SELECT pk, sk, update_text, type, gate, phase, actor, created_at
FROM "kiro_gov_ddb"."default"."kiro-governance-tracker"
WHERE pk = 'PROJECT#<project_id>'
ORDER BY created_at DESC;
```

> Source: F-04 §5.3 Query 1

**With type filter** (reuses F-04 Access Pattern 6):

```sql
SELECT pk, sk, update_text, type, gate, phase, actor, created_at
FROM "kiro_gov_ddb"."default"."kiro-governance-tracker"
WHERE pk = 'PROJECT#<project_id>' AND type = '<macro|micro>'
ORDER BY created_at DESC;
```

> Source: F-04 §3 Access Pattern 6

### 5.2 Cross-Project Macro Gate Rollup (View 2)

Reuses F-04 §5.3 Query 3 — macro gate completion by phase:

```sql
SELECT 
  pk AS project,
  phase,
  gate,
  MIN(created_at) AS completed_at,
  actor
FROM "kiro_gov_ddb"."default"."kiro-governance-tracker"
WHERE type = 'macro' AND sk LIKE 'UPDATE#%'
GROUP BY pk, phase, gate, actor
ORDER BY phase, completed_at;
```

> Source: F-04 §5.3 Query 3

### 5.3 Filter by Gate

Reuses F-04 §5.3 Query 4:

```sql
SELECT pk, update_text, actor, created_at
FROM "kiro_gov_ddb"."default"."kiro-governance-tracker"
WHERE gate = '<gate_name>'
ORDER BY created_at DESC;
```

> Source: F-04 §5.3 Query 4

### 5.4 Filter by Phase

```sql
SELECT pk, update_text, type, gate, actor, created_at
FROM "kiro_gov_ddb"."default"."kiro-governance-tracker"
WHERE phase = '<phase_name>' AND sk LIKE 'UPDATE#%'
ORDER BY created_at DESC;
```

> `Architect decision — not customer-specified:` Additional query for the phase filter AC. Uses the `phase` attribute which is stored on event records per F-04 §2.3.

### 5.5 All Macro Events Across Projects

Reuses F-04 §5.3 Query 2:

```sql
SELECT pk, gate, phase, actor, created_at, update_text
FROM "kiro_gov_ddb"."default"."kiro-governance-tracker"
WHERE type = 'macro'
ORDER BY created_at DESC;
```

> Source: F-04 §5.3 Query 2

---

## 6. Access Control

### 6.1 Dashboard Audience

| Who | Access Level | Source |
|-----|-------------|--------|
| Internal team (delivery leads, PMs, engineering) | QuickSight Author — full dashboard access | SRS §3 Stakeholders |

> `Architect decision — not customer-specified:` Dashboard is internal-only. No external/client access for POC.

### 6.2 User Provisioning

> `Architect decision — not customer-specified:` **Manual provisioning** for POC.

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| SSO/SAML federation | Automated provisioning; matches enterprise patterns | Requires identity provider setup; overkill for <5 users | ❌ Rejected for POC |
| **Manual invite** | Simple; QuickSight Console → Invite users; immediate | Manual process; doesn't scale | ✅ Selected for POC |

**Process:**
1. Admin navigates to QuickSight Console → Manage QuickSight → Manage users
2. Invites team members by email
3. Assigns Author role ($12/mo per user)
4. Shares the dashboard with invited users

**Cost note:** Each Author user costs $12/mo. For POC, expect 1-2 Author users. Reader access is $5/session (pay-per-session) — consider for occasional viewers.

---

## 7. Edge Cases

| # | Scenario | Handling | Source |
|---|----------|----------|--------|
| 1 | DynamoDB table is empty (no governance events yet) | Dashboard displays empty visuals with "No data available" message. QuickSight handles empty result sets gracefully — no error. Table visual shows column headers with no rows. Bar chart shows empty axes. | `Architect decision — not customer-specified` |
| 2 | Athena connector Lambda cold start causes slow query | First query after idle period takes 5-10s (Lambda 512 MB cold start). QuickSight shows a loading spinner. Subsequent queries in the same session are fast (warm Lambda). Direct Query mode means users see the spinner on every dashboard load if Lambda is cold. | `Architect decision — not customer-specified` |
| 3 | QuickSight SPICE refresh fails | N/A — using Direct Query mode, not SPICE. No scheduled refresh to fail. | `Architect decision — not customer-specified` |
| 4 | Athena query exceeds 100 MB scan cutoff | Query is terminated by workgroup policy. QuickSight displays an error. At POC volume (<1000 records, each ~500 bytes), total table size is <500 KB — well under the 100 MB limit. This edge case is not reachable at POC scale. | F-04 §5.4 — 100 MB cutoff |
| 5 | QuickSight Author license expires or user removed | Dashboard becomes inaccessible to that user. Other Authors retain access. Admin re-invites or renews. No data loss. | `Architect decision — not customer-specified` |
| 6 | `phase` attribute is null/absent on some records | Queries filtering by phase will exclude records without a `phase` value. The cross-project rollup (Query 3) groups by phase — records without phase appear as NULL group. QuickSight displays this as "(blank)". | F-04 §2.3: "phase: Optional" |

---

## 8. Hallucination Gate H2 — Self-Check

| Item | Value | Source |
|------|-------|--------|
| Dashboard technology: Amazon QuickSight | — | SRS OQ-03 resolution, Customer 2026-06-10 |
| Data pipeline: DynamoDB → Athena → QuickSight | — | SRS FR-08: "DynamoDB → Athena Federated Query connector → QuickSight" |
| Athena workgroup: `kiro-governance` | — | F-04 §5.4 |
| Athena data catalog: `kiro_gov_ddb` | — | F-04 §5.1 |
| Athena connector Lambda: `kiro-gov-athena-ddb-connector` | — | F-04 §5.1 |
| QuickSight IAM role: `kiro-gov-quicksight-athena-role` | — | F-04 §6.1 Role 4 |
| S3 results bucket: `kiro-governance-athena-results-<account_id>` | — | F-04 §5.2 |
| DynamoDB table: `kiro-governance-tracker` | — | SRS §6, F-04 §2.1 |
| QuickSight cost: $12/mo (Author license) | — | SRS NFR-05 |
| QuickSight edition: Standard | — | `Architect decision — not customer-specified` |
| Dataset mode: Direct Query (no SPICE) | — | `Architect decision — not customer-specified` |
| User provisioning: Manual invite | — | `Architect decision — not customer-specified` |
| Dashboard audience: Internal team only | — | `Architect decision — not customer-specified` |
| FR-08 ACs: per-project timeline, cross-project rollup, filters (project, gate, phase, type) | — | SRS FR-08 AC |
| Athena SQL queries: reused from F-04 §5.3 | — | F-04 §5.3 Queries 1-4 |
| Phase filter query (§5.4) | — | `Architect decision — not customer-specified` (additional query for filter AC) |
| Visual types: Table, Pivot Table, Horizontal Bar Chart | — | `Architect decision — not customer-specified` |
| Bytes scanned cutoff: 100 MB | — | F-04 §5.4 |
| Lambda cold start: 5-10s for 512 MB | — | F-04 §8.3 |

---

## 9. Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| QuickSight Author (1 user) | $12.00 | SRS NFR-05. Additional Authors: +$12/mo each |
| Athena queries (via QuickSight) | ~$0.50 | Included in F-04 estimate; shared cost. <100 MB scanned/month |
| Total F-05 infrastructure | ~$12.00/mo | QuickSight is the sole incremental cost for this feature |

> Source: SRS NFR-05 — "QuickSight: ~$12/mo (Author license)". Total POC ~$25-30/mo; F-05's share is $12/mo.

---

*End of Reporting Architecture v1.0*
