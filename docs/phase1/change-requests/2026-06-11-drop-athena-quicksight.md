# Change Request — Drop Athena & QuickSight from Scope

**Date:** 2026-06-11
**Author:** AWS Architect
**Status:** Approved — implement immediately

---

## Summary

Athena and QuickSight are removed entirely from `kiro_governance` scope — the delivery boundary for reporting (FR-08) ends at a queryable DynamoDB table with GSIs. Additionally, the KG-13 integration test will run directly from Kiro CLI rather than a separate test harness.

---

## Source

`Customer decision — Faraz, 2026-06-11: Athena and QuickSight are not our domain. DynamoDB table is the delivery boundary for reporting. Integration test runs from Kiro CLI.`

---

## Affected SRS Sections

| Section | Current State | Required Change |
|---------|--------------|-----------------|
| **FR-08** (§8) | "Dashboard = Amazon QuickSight connected to DynamoDB via Athena DynamoDB federated query connector" | Scope narrows to: "Data available in DynamoDB table (`kiro-governance-tracker`) with GSIs, queryable by external consumers. Dashboard implementation is out of scope." |
| **§4.2 Out of Scope** | Lists Pathway 2, Aurora, npm distribution, centralised secrets, compliance | Add: "Athena DynamoDB connector", "QuickSight dashboard", "S3 Athena results/spill buckets" |
| **§6 System Components** | Includes rows for "Athena" and "Dashboard (QuickSight)" | Remove both rows. Replace with note: "DynamoDB table serves as the queryable data layer for any future reporting tool." |
| **§9 NFR-05 Cost** | Total ~$20.49/mo including QuickSight $12, Athena ~$0.50 | Remove QuickSight ($12), Athena ($0.50), S3 Athena buckets ($0.02). Revised total: **~$8.49/mo** |
| **§12 OQ-03** | Resolution: "Dashboard = Amazon QuickSight" | Resolution changes to: "QuickSight dropped from scope (customer decision 2026-06-11). DynamoDB table with GSIs is the delivery boundary. External consumers can query directly or attach any BI tool." |
| **§13 Dependencies** | Includes "Amazon QuickSight" and "Athena DynamoDB federated query connector" | Remove both entries |

---

## Affected Architecture Docs

### F-04 — `data-persistence-architecture.md`

| Section | Action |
|---------|--------|
| §1 Overview | Remove "FR-08 (read source) — QuickSight dashboard reads via Athena federated query" reference. Replace with "FR-08 (read source) — external consumers query DynamoDB directly via GSIs" |
| §5 Athena Federated Query Connector (entire section) | **DELETE** — §5.1 connector setup, §5.2 S3 bucket for results, §5.3 sample Athena SQL queries, §5.4 Athena workgroup |
| §6.1 IAM Role 2 (Athena connector Lambda role) | **DELETE** — `kiro-gov-athena-connector-role` no longer needed |
| §6.1 IAM Role 3 (QuickSight role) | **DELETE** — `kiro-gov-quicksight-athena-role` no longer needed |
| §7.1 CDK Stack | Remove: `athenaResultsBucket`, `athenaSpillBucket`, `AthenaWorkgroup`, `AthenaConnectorRole`, `QuickSightRole`, `athena` import. Keep: DynamoDB table, GSIs, MCP server role, SSM parameters |
| §7.2 Athena Connector Deployment (entire section) | **DELETE** — SAR deployment + data catalog registration no longer needed |
| §8.3 Edge Cases — Athena Connector Cold Start/Timeout | **DELETE** |
| §9 H2 Self-Check | Remove Athena/QuickSight validation rows |
| §10 Cost Estimate | Remove Athena queries ($0.50), Athena connector Lambda ($0), S3 results+spill ($0.03). New F-04 total: **~$0.00/mo** (DynamoDB free tier only) |

### F-05 — `reporting-architecture.md`

**Action:** Entire document is **OUT OF SCOPE**. Mark as superseded. The file should be retained with a header noting it was dropped per this change request (for audit trail), or deleted entirely.

### `unified-data-model.md`

| Section | Action |
|---------|--------|
| §1 Overview table | Remove row for "Athena Results" S3 store. Update to show only DynamoDB + SSM. |
| §4 S3 — Athena Results Bucket (entire section) | **DELETE** — both results and spill bucket definitions |
| §7 Cross-Document Consistency | Remove F-05 references from field name consistency table |

### `feature-list.md`

| Item | Action |
|------|--------|
| F-04 row (Description) | Remove "Athena DynamoDB federated query connector (Lambda-based) + S3 spill bucket" from description. New description: "DynamoDB single-table (`kiro-governance-tracker`) with PK/SK design, GSI on `type`/`gate` for cross-project queries. **Shared infrastructure** required by FR-02 (write target via F-01)." |
| F-05 row | **DELETE** entire row |
| §2 FR Coverage | FR-08 moves from F-05 → mark as "Out of scope (DynamoDB table is delivery boundary)" or remove the row |
| §3 Feature Dependency Order | Remove `F-05 (QuickSight)` from dependency graph. Remove "← depends on F-04 (reads via Athena)" line |
| §4 Notes | Remove note #4 about FR-08 ownership by F-05 |

### `domain-decomposition.md`

| Item | Action |
|------|--------|
| §2 Domain 4 (Data & Persistence) — Interfaces table | Remove "Reporting" outbound interface row. Remove "Athena DynamoDB Federated Query Connector" and "S3 bucket for Athena query spill/results" from key components |
| §2 Domain 5 (Reporting) — entire section | **DELETE** |
| §3 Cross-Domain Interface Table | Remove row #7 (Athena → DynamoDB read) |
| §4 FR Coverage | FR-08 → mark as "Out of scope" or remove |
| §5 Dependency Graph | Remove "Reporting (FR-08)" node and the Data & Persistence → Reporting arrow |
| §6 Notes | Remove note #1 reference to "FR-08 reads from" |

---

## Affected Backlog Stories

| Story ID | Epic | Sprint | Action | Detail |
|----------|------|--------|--------|--------|
| **KG-10** | Reporting (F-05) | Sprint 3 | **DROP** | Athena DDB connector deployment — entirely out of scope |
| **KG-11** | Reporting (F-05) | Sprint 3 | **DROP** | QuickSight dataset setup — entirely out of scope |
| **KG-12** | Reporting (F-05) | Sprint 3 | **DROP** | QuickSight dashboard — entirely out of scope |
| **KG-13** | Integration & Validation | Sprint 3 | **UPDATE** | Test runs from Kiro CLI agent workflow, not a separate test harness. AC should verify full Pathway 1 flow by triggering it through the Kiro CLI agent workflow (orchestrator calls MCP tools → DynamoDB record created → Slack fires). Remove any AC referencing Athena/QuickSight query validation. |
| **KG-14** | Integration & Validation | Sprint 3 | **UPDATE** | Remove QuickSight-related runbook content. Keep: TLS cert rotation, EC2 deploy, API key rotation, SSM webhook configuration. |

### Sprint 3 Revised

| Before | After |
|--------|-------|
| KG-10 (2) + KG-11 (2) + KG-12 (3) + KG-13 (5) + KG-14 (2) = **14 pts** | KG-13 (5) + KG-14 (2) = **7 pts** |

**Options:**
1. Keep Sprint 3 as a short sprint (7 pts) — allows buffer for any Sprint 2 overflow
2. Merge KG-13 + KG-14 into Sprint 2 (Sprint 2 goes from 16 → 23 pts) — likely over-capacity
3. Keep Sprint 3 at 7 pts — **recommended** (validates end-to-end before declaring done)

---

## Cost Impact

| Component | Before ($/mo) | After ($/mo) | Delta |
|-----------|---------------|--------------|-------|
| EC2 t3.micro | $8.47 | $8.47 | — |
| DynamoDB (on-demand, free tier) | $0.00 | $0.00 | — |
| GitHub Actions (free tier) | $0.00 | $0.00 | — |
| SSM Parameter Store | $0.00 | $0.00 | — |
| QuickSight Standard (1 Author) | $12.00 | **$0.00** | -$12.00 |
| Athena queries | ~$0.50 | **$0.00** | -$0.50 |
| Athena connector Lambda | ~$0.00 | **$0.00** | — |
| S3 (Athena results + spill) | ~$0.02 | **$0.00** | -$0.02 |
| **Total** | **~$20.49/mo** | **~$8.47/mo** | **-$12.02/mo** |

**Budget alarm recommendation:** Reduce from $35/mo → **$15/mo** (still ~77% buffer above the $8.47 estimate).

---

## Action Items

- [x] Update SRS to v1.6 — narrow FR-08, update §4.2/§6/§9/§12/§13 (product analyst)
- [x] Update F-04 (`data-persistence-architecture.md`) — remove §5, §6.1 Roles 2+3, §7.1 Athena/S3/QuickSight CDK, §7.2, §8.3, update §1/§9/§10 (architect)
- [x] Mark F-05 (`reporting-architecture.md`) as superseded (architect)
- [x] Update `unified-data-model.md` — remove §4 S3 section, update §1 overview (architect)
- [x] Update `feature-list.md` — remove F-05 row, update F-04 description, update §2/§3/§4 (architect)
- [x] Update `domain-decomposition.md` — remove Domain 5, update §3/§4/§5 (architect)
- [x] Update `jira-backlog.csv` — drop KG-10/11/12, update KG-13 AC, update KG-14 AC, revise Sprint 3 (technical PM)
- [x] Update `cost-estimate.md` — remove QuickSight/Athena/S3 lines, revise total to ~$8.47/mo, lower budget alarm (architect)
- [x] Update KG-01 AC — remove S3 Athena buckets, remove `kiro-gov-athena-connector-role`, remove `kiro-gov-quicksight-athena-role`, remove Athena workgroup (technical PM)

---

## Recommendation

**Implement immediately.** No in-progress stories are affected — sprint planning just completed and implementation has not started. Zero retrofit cost. This is a pure scope reduction with no architectural risk.

---

*End of Change Request*

---

All action items completed 2026-06-11.
