# Architect Delta Review — SRS v1.3

**Document:** `docs/srs.md` v1.3
**Reviewer:** AWS Architect
**Date:** 2026-06-10
**Scope:** OQ-01 through OQ-04 resolutions and dependent section updates only
**Verdict:** CHANGES REQUIRED

---

## Findings Table

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| 1 | High | Architecture | QuickSight has **no direct DynamoDB connector**. The SRS states "QuickSight connects to DynamoDB" without specifying the intermediary. Actual path requires: DynamoDB → Athena Federated Query (via DynamoDB connector Lambda) → QuickSight, OR DynamoDB → S3 Export → Athena → QuickSight. | Amend FR-08 and §6 to explicitly state the data pipeline: QuickSight → Athena (federated query with DynamoDB connector). Add Athena to §13 Dependencies. Document additional cost (~$5/TB scanned by Athena). | Medium |
| 2 | Medium | Cost | QuickSight adds significant cost that breaks the stated POC budget of "<$15/mo". Minimum: 1 Author ($24/mo annual or $34/mo monthly for Standard). Plus Athena connector Lambda execution + Athena query costs. Total dashboard cost likely $25–40/mo — more than double the rest of the POC combined. | (a) Update §9 NFR-05 cost section to reflect true QuickSight cost. (b) Consider whether QuickSight is appropriate for a POC this size, or whether a simpler alternative (CloudWatch dashboard, or a static HTML page reading DynamoDB via the existing EC2) would suffice. Flag to customer as a cost decision. | Low |
| 3 | Medium | Scope | OQ-02 BLOCKER scoping: SRS flags FR-01/FR-02/FR-05 as blocked. However, FR-02 (DynamoDB Write) does NOT strictly require `project_id` resolution — it uses `project_id` only as the PK prefix (`PROJECT#<project_id>`). If the team agrees on *any* stable identifier (even repo name as interim), FR-02's implementation is unblocked. The true blockers are FR-01 (webhook routing depends on `project_id` → URL mapping) and FR-05 (orchestrator must pass `project_id`). FR-02 is blocked only if the PK format must be JIRA-based. | Refine OQ-02 impact statement: FR-01 and FR-05 are hard-blocked. FR-02 is soft-blocked (can proceed with a placeholder PK convention that gets migrated). This allows partial progress while awaiting Waleed's R&D. | Low |
| 4 | Low | Security | OQ-04 resolution (SSM Parameter Store SecureString) is architecturally sound for an EC2-hosted POC. No concerns. The EC2 instance profile can grant `ssm:GetParameter` with resource-level scoping. Free tier covers POC volume. Trivially upgradable to Secrets Manager later. | No action needed. Approved as-is. | — |
| 5 | Low | Implementation | OQ-01 resolution (one webhook per project, mapping in SSM) is clean. However, the SRS doesn't specify the SSM parameter naming convention. | Recommend adding a note to FR-01: SSM parameter path convention e.g. `/kiro-governance/slack-webhooks/<project_id>`. Not a blocker — can be resolved during architecture doc. | Low |
| 6 | Info | Consistency | §6 System Components table says "QuickSight connected to DynamoDB" and §13 Dependencies says "QuickSight account + DynamoDB connector". The term "DynamoDB connector" is ambiguous — it could be misread as a native QuickSight feature (which doesn't exist). Should say "Athena DynamoDB federated query connector". | Clarify terminology in §6 and §13 to avoid implementation confusion. | Low |

---

## Detailed Analysis

### OQ-01: Slack Webhook Provisioning ✅ APPROVED

- **Resolution:** One webhook per project channel, `project_id` → webhook URL mapping in SSM Parameter Store.
- **Assessment:** Clean, simple, scalable. SSM supports up to 10,000 parameters (Standard tier, free). Each webhook URL is ~100 chars. SecureString encryption via KMS adds no cost with the default `aws/ssm` key.
- **Consistency:** Aligns with OQ-04 (SSM for secrets) and FR-01 implementation notes.

### OQ-02: `project_id` Resolution ⚠️ PARTIALLY BLOCKED

- **Resolution:** JIRA project ID as `project_id`, pending R&D with Waleed.
- **Assessment:** The resolution itself is reasonable — JIRA project ID is stable, unique, and human-readable. The BLOCKER status is correct in principle.
- **Scoping concern:** The SRS says FR-01/FR-02/FR-05 are all blocked. More precisely:
  - **FR-01 (Slack):** Hard-blocked — cannot route notifications without knowing which SSM key to read.
  - **FR-05 (Orchestrator hook):** Hard-blocked — must pass `project_id` to MCP server.
  - **FR-02 (DB write):** Soft-blocked — the DynamoDB PK uses `PROJECT#<project_id>`, but implementation can proceed with any stable identifier convention. If the team agrees "use repo name as interim `project_id`", FR-02 can be developed and later migrated via a one-time PK update script if JIRA ID differs.
- **Recommendation:** Differentiate hard vs soft blockers to enable parallel work.

### OQ-03: Dashboard = QuickSight ⚠️ CHANGES REQUIRED

- **Resolution:** Amazon QuickSight pulling from DynamoDB.
- **Assessment — Viability:** QuickSight is a valid BI tool, but it does **not** have a native DynamoDB data source. Confirmed via AWS documentation — QuickSight's supported data sources are: Athena, S3, Redshift, RDS/Aurora, OpenSearch, Timestream, Snowflake, Databricks, Salesforce, and JDBC/ODBC databases. DynamoDB is notably absent.

  **To connect QuickSight to DynamoDB, one of these paths is required:**

  | Path | Components | Latency | Cost |
  |------|-----------|---------|------|
  | **A. Athena Federated Query** | Athena DynamoDB Connector (Lambda) + Athena + QuickSight | Near-real-time (queries DDB live) | Lambda invocations + Athena $5/TB scanned |
  | **B. S3 Export + Athena** | DynamoDB Export to S3 (or Glue ETL) + Athena + QuickSight | Batch (hourly/daily export) | S3 storage + Athena $5/TB scanned |
  | **C. DynamoDB Streams → S3** | Streams + Lambda/Firehose → S3 + Athena + QuickSight | Near-real-time | Stream reads + Lambda + S3 + Athena |

  **For this POC (low volume, few projects), Path A (Athena Federated Query) is simplest** — deploy the Athena DynamoDB connector from Serverless Application Repository, point QuickSight at the Athena data catalog.

- **Cost impact:**
  - QuickSight Author (Standard, monthly): **~$12/mo** (pay-per-session pricing with 1 author)
  - Athena queries at POC volume (<1MB scanned): **~$0.01/mo**
  - DynamoDB connector Lambda: **~$0.01/mo** (negligible at POC volume)
  - **Total dashboard cost: ~$12–15/mo** (more than doubling the POC infrastructure budget)

- **Consistency issue:** The SRS phrase "QuickSight will connect to DynamoDB" and "DynamoDB connector" implies a direct connection that doesn't exist. This will confuse implementors.

- **Alternative worth flagging to customer:**

  | Option | Monthly Cost | Effort | Trade-off |
  |--------|-------------|--------|-----------|
  | QuickSight + Athena federated query | ~$12–15/mo | Medium (deploy connector, configure Athena catalog, build QuickSight dashboard) | Full BI features, overkill for POC |
  | CloudWatch Dashboard (custom metrics from DynamoDB) | ~$3/mo | Low (push metrics from MCP server) | Limited visualization, no cross-project drill-down |
  | Simple HTML dashboard on existing EC2 | $0 incremental | Low-Medium (build a read endpoint) | Custom code, but zero additional AWS services |

### OQ-04: SSM Parameter Store for Secrets ✅ APPROVED

- **Resolution:** SSM Parameter Store (SecureString) for Slack webhooks + DynamoDB creds; GitHub Encrypted Secrets for MCP API key.
- **Assessment:** Correct choice for an EC2-hosted POC:
  - EC2 instance profile grants `ssm:GetParameter` — no credentials needed in env vars
  - SecureString uses KMS encryption at rest (default `aws/ssm` key = free)
  - Free tier: 10,000 Standard parameters, 40 TPS for GetParameter
  - GitHub Encrypted Secrets for the Actions workflow API key is the correct GitHub-native approach
- **Security notes:**
  - Ensure the EC2 instance profile has resource-scoped IAM: `arn:aws:ssm:*:*:parameter/kiro-governance/*`
  - Avoid `ssm:GetParameter*` with wildcard resource — scope to the governance path prefix
- **No concerns.** This is the correct pattern for internal tooling POCs.

---

## Blocker Summary

| Item | Status | Action Required |
|------|--------|----------------|
| OQ-02 (JIRA `project_id`) | ⚠️ BLOCKER — confirmed | Awaiting Waleed R&D. Consider allowing interim `project_id` (repo name) for FR-02 development. |
| QuickSight → DynamoDB path | ⚠️ NEW CONCERN | SRS must document the Athena intermediary. Customer should confirm budget acceptance (~$12–15/mo additional). |

---

## Verdict: **CHANGES REQUIRED**

### Required changes before approval (must fix):

1. **FR-08 + §6 + §13:** Explicitly document that QuickSight connects to DynamoDB **via Athena Federated Query** (not directly). Add "Amazon Athena" and "Athena DynamoDB Connector (Lambda)" to §13 Dependencies.
2. **§9 NFR-05:** Update POC cost estimate to include QuickSight (~$12/mo Author) + Athena (negligible at POC scale). New total: ~$25–30/mo.

### Recommended changes (should fix, not blocking):

3. Refine OQ-02 BLOCKER scope: distinguish FR-01/FR-05 (hard-blocked) vs FR-02 (soft-blocked, can proceed with interim ID).
4. Add SSM parameter naming convention note to FR-01 (e.g., `/kiro-governance/slack-webhooks/<project_id>`).
5. Clarify "DynamoDB connector" terminology in §6 and §13 to say "Athena DynamoDB federated query connector" to avoid ambiguity.

### Optional — flag to customer:

6. QuickSight may be over-engineered for a POC with <5 projects and <100 records. Consider a lightweight alternative and defer QuickSight to post-POC if budget is a concern. This is a customer cost decision, not a technical blocker.

---

*End of delta review.*
