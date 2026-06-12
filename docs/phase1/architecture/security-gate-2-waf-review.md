# Security Gate 2 — AWS Well-Architected Framework Review

**Project:** kiro_governance
**Review Type:** Full WAF Review (Step 2.7 — Gate 2)
**Date:** 2026-06-11
**Reviewer:** security-gate-2 (aws-security-reviewer)
**Approval Threshold:** Zero Critical or High findings

## Inputs Reviewed

| Document | Version |
|----------|---------|
| `docs/srs.md` | v1.5 |
| `docs/phase1/mcp-server-core-architecture.md` | F-01 v1.2 |
| `docs/phase1/agent-integration-architecture.md` | F-02 v1.2 |
| `docs/phase1/github-trigger-architecture.md` | F-03 v1.3 |
| `docs/phase1/data-persistence-architecture.md` | F-04 v1.5 |
| `docs/phase1/reporting-architecture.md` | F-05 v1.0 |

## Context

- **Project type:** Internal developer tooling POC
- **Compliance:** None required
- **Scale:** Low volume, single team, single region (`us-east-1`)
- **Budget:** ~$25–30/mo
- **Previously resolved (Gate 1 + 1.5):** Self-signed TLS, SSM SecureString secrets, API key auth, append-only DynamoDB with explicit DENY, cert fingerprint pinning, `.env` gitignore rule, permissions block on workflow, SSM KMS Decrypt scope

---

## Pillar 1 — Operational Excellence

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| OE-1 | Medium | Runbooks | No runbook or operational procedure documented for any failure scenario. SRS §15 lists EC2 unavailability and runner IP allowlist failures as risks, but no runbook exists. For a POC with a single on-call team, informal recovery is acceptable — but the cert rotation procedure in F-01 §8.2 is a multi-step manual process with no documented steps beyond the openssl command. A missed step (e.g., not updating `MCP_CERT_FINGERPRINT` in GitHub Secrets after rotating the EC2 cert) will silently break the GitHub trigger path with an opaque TLS fingerprint mismatch error. | Document a one-page cert rotation runbook covering: (1) regenerate cert on EC2, (2) extract fingerprint, (3) update `MCP_CERT_FINGERPRINT` GitHub Secret, (4) update developer `.env` files, (5) restart MCP server. Add to `docs/runbooks/cert-rotation.md`. | Low |
| OE-2 | Medium | Deployment | No documented EC2 provisioning or deployment procedure beyond the user-data script in F-01 §8.1. The script uses a placeholder `<repo-url>` which will cause the first deploy to fail silently. There is also no documented process for deploying code changes after initial setup (the user-data script only runs once). | Replace `<repo-url>` placeholder with actual repo URL. Add a `docs/runbooks/ec2-deploy.md` covering initial provisioning and subsequent code deploys (git pull + npm ci + npm run build + systemctl restart). | Low |
| OE-3 | Low | Monitoring | No alerting beyond CloudWatch Logs is documented. F-01 §9.3 defines four custom CloudWatch metrics but no alarms are defined on them. An MCP server crash or sustained Slack failure would produce log entries but no proactive notification. | Define at least two CloudWatch alarms: (1) EC2 `StatusCheckFailed` → SNS email; (2) `SlackFailureCount` > 3 in 5 minutes → SNS email. Both are low effort and within the budget. | Low |
| OE-4 | Low | CI Visibility | GitHub Actions workflow failure (MCP unreachable, TLS mismatch, bad API key) is visible only to users watching the repository. There is no notification channel to alert the team of a failed governance capture. A failed workflow means the GitHub trigger path silently missed a macro event, and the team may not notice. | Add a `workflow_run` or `on: failure:` notification step to `.github/workflows/governance-trigger.yml` that posts to the project Slack channel or sends an email when the workflow fails. GitHub natively supports email notifications on workflow failure via repository settings. | Low |
| OE-5 | Info | IaC | CDK stack (`DataPersistenceStack`) is defined in F-04 §7.1 for DynamoDB, S3, and IAM resources. EC2 provisioning is via user-data script only (no CDK/CloudFormation). This is a known gap for the POC — the EC2 setup is semi-manual. | Accepted for POC. Document the gap in the implementation notes so it is not forgotten before production. | — |

---

## Pillar 2 — Security (Delta Check)

> Gate 1 and 1.5 addressed the primary security findings. This section covers only new gaps identified during the full WAF review.

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| SEC-1 | Low | IAM | The CDK stack in F-04 §7.1 creates `kiro-gov-mcp-server-role` with `this.table.grant(mcpServerRole, 'dynamodb:PutItem', 'dynamodb:Query')` — but does **not** include the explicit `Deny` on `DeleteItem`/`UpdateItem` that is specified in the IAM JSON policy in §6.1. The CDK code and the IAM JSON policy are inconsistent. The CDK's `grant()` call only adds Allow statements; the Deny must be added explicitly via `addToPolicy`. | Add the following to the CDK stack after `this.table.grant(...)`: `mcpServerRole.addToPolicy(new iam.PolicyStatement({ effect: iam.Effect.DENY, actions: ['dynamodb:DeleteItem', 'dynamodb:UpdateItem'], resources: [this.table.tableArn] }))` | Low |
| SEC-2 | Low | Secrets | F-02 §6.3 states the `.env` file "must be listed in `.gitignore`" but does not specify whether a `.gitignore` rule has been confirmed as present. The `.env.example` file is committed, but if the base `.gitignore` for the repo was not pre-configured with `.env`, a developer bootstrapping from `.env.example` could accidentally commit real secrets. | Confirm `.env` is in `.gitignore`. Add it explicitly (not relying on a template) and verify with `git check-ignore -v .env` in the implementation notes. | Low |
| SEC-3 | Info | TLS | Self-signed TLS (Option B) and API key auth are accepted risks per Gate 1. No new delta. The cert fingerprint pinning via `checkServerIdentity` (F-03 v1.3) adequately addresses the previous HIGH finding. | No action required. | — |
| SEC-4 | Info | DynamoDB | Append-only enforcement via explicit IAM Deny (`DeleteItem`/`UpdateItem`) on the EC2 role is documented and correct (F-04 v1.5). PITR enabled. Deletion protection enabled. No new delta. | No action required. | — |

---

## Pillar 3 — Reliability

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| REL-1 | Medium | EC2 Single Point of Failure | The MCP server runs on a single EC2 t3.micro instance with no auto-recovery, no ASG, and no load balancer. A hardware failure, AZ disruption, or OS crash will take down both governance capture paths (orchestrator hook and GitHub trigger) until manual intervention. F-01 §2.3 specifies `Restart=on-failure` for process crashes only — it does not protect against instance-level failures. SRS NFR-02 states "no uptime SLA" and calls this acceptable for a POC. | For POC: enable EC2 Auto Recovery via a CloudWatch alarm on `StatusCheckFailed_System` → recover action. This restores the instance on hardware failure with the same IP, same EBS, within ~5 minutes, at zero cost. This is not HA — it does not protect against AZ outages — but covers the most common failure mode (hardware failure). | Low |
| REL-2 | Low | DynamoDB PITR | F-04 §2.1 documents PITR as enabled (`pointInTimeRecovery: true`). The CDK stack in §7.1 also sets this. This is correctly implemented — no gap. Confirmed compliant. | No action required. | — |
| REL-3 | Low | Dual-Path Dedup Race Condition | The dedup sentinel pattern (F-04 §4.2) uses DynamoDB conditional PutItem (`attribute_not_exists(pk)`) which is atomic. F-04 §8.2 explicitly covers the race condition case and confirms exactly-one-wins behavior. The concern about dual-trigger races is fully addressed by the design. | No action required. Pattern is correct. | — |
| REL-4 | Low | GitHub Actions Retry | The workflow (F-03) does not implement retry logic on MCP call failure. A transient network issue causes the workflow to fail (exit code 1) and requires a manual re-run. The orchestrator hook (F-02) also has no retry — it logs the failure and continues the workflow. | For POC: document the manual re-run procedure in the EC2 runbook. For production: add a step-level `retry-on-error` or wrap `callMcpTool` in exponential backoff (3 attempts, 1s/2s/4s). The orchestrator hook non-blocking behavior is acceptable by design. | Low |
| REL-5 | Info | MCP Server Process Restart | F-01 §2.3: `systemd` with `Restart=on-failure, RestartSec=5`. In-flight requests during restart are lost. F-01 §11 edge case 5 documents this: "Caller receives connection error and should retry. Idempotency sentinel ensures no double-write on retry." The design is correct and the edge case is documented. | No action required. | — |

---

## Pillar 4 — Performance Efficiency

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| PERF-1 | Low | NFR-01 p95 < 5s | The p95 < 5s target (SRS NFR-01) covers EC2-to-DynamoDB + Slack webhook. Breaking down the path: (1) DynamoDB PutItem in same region: ~2–5ms typical; (2) Slack webhook POST (external HTTPS): ~100–300ms typical; (3) SSM GetParameter: ~10–20ms (cached after first call); (4) MCP server overhead + TLS: ~10–20ms. Total typical: ~150–350ms. The p95 target of 5s has ample headroom. The one risk is Slack's p99 latency — Slack webhooks can spike to 2–3s under their load conditions. Even so, 5s is achievable. | No action required. p95 < 5s is achievable. Monitor `DynamoDBWriteLatency` custom metric (F-01 §9.3) to confirm after deployment. | — |
| PERF-2 | Low | EC2 t3.micro Sizing | t3.micro (1 GiB RAM, 2 vCPU burstable) is specified for a Node.js 20 MCP server with <100 requests/day. The AWS SDK (DynamoDB + SSM) and the MCP SDK together consume ~100–150 MB RSS at idle. The process never runs concurrent CPU-bound work. t3.micro is well-sized for this workload. The only risk is CPU credit exhaustion under unexpected burst, but at <100 req/day, credits will always be fully charged. | No action required. Monitor CPU credit balance in CloudWatch for the first two weeks after launch. | — |
| PERF-3 | Low | Athena Latency for Dashboard | F-05 §2.3 selects Direct Query mode (no SPICE). Queries hit the Athena DynamoDB connector Lambda. Cold start is 5–10s (512 MB Lambda). At POC volume, table scan completes in <1s after warm-up. The first dashboard load after idle will be slow (5–10s). This is a known trade-off documented in F-05 §7 edge case 2. It is acceptable for a non-latency-sensitive governance dashboard. | No action required for POC. Document expected cold start behavior in dashboard usage notes so users are not surprised. | — |
| PERF-4 | Info | DynamoDB On-Demand | PAY_PER_REQUEST is correctly chosen for POC scale. At <100 events/day, on-demand costs are negligible and no capacity planning is needed. | No action required. | — |

---

## Pillar 5 — Cost Optimization

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| COST-1 | Low | Cost Estimate Accuracy | The SRS NFR-05 total of ~$25–30/mo is plausible. Breaking it down: EC2 t3.micro $7.49/mo + Elastic IP $0 (attached) + CloudWatch Logs ~$0.50/mo + Athena ~$0.50/mo + QuickSight Author $12/mo + SSM $0 + DynamoDB $0 + GitHub Actions $0 ≈ **$20.49/mo**. This is within the $25–30 band, leaving ~$5–10 headroom for CloudWatch alarms, additional log volume, or a second QuickSight user. The estimate is accurate. | No action required. | — |
| COST-2 | Low | EC2 Data Transfer | EC2 to DynamoDB in the same region (`us-east-1`) does NOT use VPC endpoints in the current design. Without a VPC endpoint for DynamoDB, traffic routes through the public internet via NAT or the internet gateway, incurring EC2 data transfer costs. However, at <100 events/day with payloads of ~1 KB each, monthly transfer is <3 MB — below the 1 GB/mo free tier for EC2 outbound. **Cost impact: $0.** SSM API calls are also public internet routed at POC scale, same conclusion. | No action required at POC scale. Note for production: add VPC endpoints for DynamoDB and SSM to eliminate data transfer costs at scale and reduce attack surface. | Low |
| COST-3 | Low | QuickSight Reader Licensing | F-05 §6.2 notes Reader access is $5/session for occasional viewers. If more than 2–3 team members use the dashboard, the per-session model may be cheaper than additional Author licenses ($12/mo). | No immediate action. If >1 Author license is needed, evaluate Reader ($5/session) vs Author ($12/mo) based on expected monthly sessions per user. | — |
| COST-4 | Info | Athena Scan Cost | F-04 §10 estimates ~$0.50/mo for Athena. At POC scale (<1000 records, each ~500 bytes → ~500 KB total table), each full scan costs $0.0000025 ($5/TB × 0.0005 GB). The 100 MB workgroup scan cutoff provides complete denial-of-wallet protection. | No action required. | — |
| COST-5 | Info | No Budget Alarm | No AWS Budgets alarm is configured. For a $30/mo POC, an unexpected misconfiguration (e.g., accidental QuickSight SPICE import, Lambda in a loop) could spike costs. | Recommendation: create an AWS Budgets alert at $35/mo (117% of target) to catch surprises. Free (first 2 budget alerts are free). | Low |

---

## Pillar 6 — Sustainability

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| SUS-1 | Info | EC2 Always-On | The EC2 t3.micro runs 24/7. For an internal POC used during business hours only, 128+ idle hours per week consume power unnecessarily. However, t3.micro is already the smallest viable instance type. At this tier, the sustainability impact is negligible (0.0104 kWh/hr at ~0.01 kW average draw = ~7.5 kWh/mo). | Optional: use EC2 Instance Scheduler to stop the instance outside business hours (~40 hrs/week active vs 168 → ~76% cost and energy reduction, ~$5.71/mo vs $7.49/mo). Not worth the operational complexity for a POC. Noted for production. | Low |
| SUS-2 | Info | Serverless Preference | Lambda would be more sustainable for the MCP server (only runs when called, ~100 times/day). However, the MCP SSE transport requires a persistent connection, which Lambda cannot maintain. The EC2 hosting decision is architecturally constrained, not a sustainability shortcut. | No action required. The EC2 choice is the correct technical decision for this workload. The Athena connector and its underlying Lambda are already serverless (correctly sized). | — |
| SUS-3 | Info | Graviton Preference | F-01 §2.2 selects t3.micro (x86). Graviton equivalent is t4g.micro ($0.0084/hr, ~19% cheaper, lower energy draw). However, t4g.micro requires an ARM-compatible AMI and Node.js build. For a POC this is unnecessary complexity. | Note for production: migrate to t4g.micro or Graviton-based instance for both cost (~$1/mo saving) and sustainability benefit. | — |

---

## Cross-Document Consistency Checks

| Check | Status | Notes |
|-------|--------|-------|
| EC2 IAM role permissions (CDK vs JSON policy) | ⚠️ Gap | SEC-1: CDK stack missing explicit Deny on DeleteItem/UpdateItem |
| DynamoDB table name consistent across all docs | ✅ | `kiro-governance-tracker` used consistently in F-01, F-02, F-03, F-04, F-05 |
| Idempotency key format consistent (F-01 vs F-04) | ✅ | Both: `<project_id>#<gate>#<YYYY-MM-DD>` for macro |
| Tool names consistent (F-01 vs F-02 vs F-03) | ✅ | `record_progress`, `notify_slack` consistent across all docs |
| project_id = GitHub repo name consistent | ✅ | Customer-confirmed, consistent across all docs |
| Gate list (10 gates) consistent | ✅ | Same list in F-01, F-02, F-04 |
| Cost total (~$25–30/mo) | ✅ | Sum of per-feature estimates aligns |
| Security group port 443 open to 0.0.0.0/0 | ✅ Accepted Risk | Documented in F-01 §2.5 with justification |
| Dedup sentinel pattern consistent (F-01 vs F-04) | ✅ | F-01 §5.2 references F-04 §4.2 correctly |
| MCP endpoint path `/mcp` | ✅ | Consistent F-01, F-02, F-03 |

---

## Summary of All Findings

| # | Pillar | Severity | Finding |
|---|--------|----------|---------|
| OE-1 | Operational Excellence | Medium | No cert rotation runbook |
| OE-2 | Operational Excellence | Medium | EC2 deploy procedure missing; `<repo-url>` placeholder |
| OE-3 | Operational Excellence | Low | No CloudWatch alarms on custom metrics |
| OE-4 | Operational Excellence | Low | No workflow failure notification |
| OE-5 | Operational Excellence | Info | EC2 not in IaC (accepted for POC) |
| SEC-1 | Security | Low | CDK stack missing explicit Deny on DeleteItem/UpdateItem |
| SEC-2 | Security | Low | `.env` gitignore not confirmed |
| SEC-3 | Security | Info | Self-signed TLS — accepted risk (Gate 1) |
| SEC-4 | Security | Info | DynamoDB append-only enforcement — correct |
| REL-1 | Reliability | Medium | EC2 no auto-recovery on hardware failure |
| REL-2 | Reliability | Low | DynamoDB PITR — confirmed correct |
| REL-3 | Reliability | Low | Dedup race condition — confirmed correct |
| REL-4 | Reliability | Low | No retry logic on MCP call failure |
| REL-5 | Reliability | Info | Process restart handling — documented correctly |
| PERF-1 | Performance | Low | p95 < 5s — achievable |
| PERF-2 | Performance | Low | t3.micro sizing — adequate |
| PERF-3 | Performance | Low | Athena cold start — known and documented |
| PERF-4 | Performance | Info | DynamoDB on-demand — correct choice |
| COST-1 | Cost | Low | Cost estimate — accurate |
| COST-2 | Cost | Low | Data transfer — $0 at POC scale |
| COST-3 | Cost | Low | QuickSight Reader vs Author — monitor |
| COST-4 | Cost | Info | Athena scan cost — negligible with cutoff |
| COST-5 | Cost | Info | No AWS Budgets alarm |
| SUS-1 | Sustainability | Info | EC2 always-on — acceptable at t3.micro scale |
| SUS-2 | Sustainability | Info | EC2 over Lambda — architecturally constrained |
| SUS-3 | Sustainability | Info | t3.micro vs t4g.micro — note for production |

**Critical findings: 0**
**High findings: 0**
**Medium findings: 3** (OE-1, OE-2, REL-1)
**Low findings: 10**
**Info findings: 8** (informational only)

---

## Required Actions Before Implementation

The approval threshold is zero Critical or High findings. There are none. The three Medium findings are recommended improvements but are **not blockers** for POC implementation — they address operational gaps that can be resolved in parallel with development.

### Medium Findings — Recommended Resolution

**OE-1 (Cert Rotation Runbook):** Create `docs/runbooks/cert-rotation.md` documenting the 5-step cert rotation process. ~1 hour effort.

**OE-2 (EC2 Deploy Procedure):** Replace `<repo-url>` placeholder in F-01 §8.1 user-data script with actual repo URL. Create `docs/runbooks/ec2-deploy.md`. ~2 hours effort.

**REL-1 (EC2 Auto-Recovery):** Add EC2 Auto Recovery alarm to the deployment checklist. No code change required — a single AWS Console action or CLI command. ~15 minutes effort.

### Low Priority — Implement at POC Wrap-up

- SEC-1: Add explicit Deny to CDK stack (5-line code change)
- SEC-2: Confirm `.env` in `.gitignore`
- OE-3: Add two CloudWatch alarms
- OE-4: Add workflow failure notification step
- COST-5: Create AWS Budgets alert

---

## Verdict

> ## ✅ APPROVED
>
> Zero Critical findings. Zero High findings.
> Three Medium findings documented above — none are implementation blockers.
> The kiro_governance architecture is approved to proceed to implementation (Step 3 — Sprint Planning).

---

*Security Gate 2 review completed: 2026-06-11*
*Reviewer: security-gate-2 (aws-security-reviewer)*
*Next step: Handoff to Technical PM for sprint planning*
