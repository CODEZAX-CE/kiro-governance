# Security Gate 1 — Architecture Doc Review

**Project:** kiro_governance
**Gate:** Security Gate 1 (Step 2.4) — Pre-Data-Model Review
**Reviewer:** security-reviewer
**Date:** 2026-06-11
**Scope:** F-01, F-02, F-03, F-04, F-05 architecture docs reviewed against AWS Well-Architected Security Pillar
**Security bar:** Internal developer tooling POC — no HIPAA/SOC2/PCI-DSS/CCPA compliance required

---

## Findings

| # | Severity | Area | Finding | Affected Doc / Section | Required Fix |
|---|----------|------|---------|------------------------|--------------|
| 1 | **High** | Network / Encryption in Transit | MCP server runs plain HTTP on port 3000. The `X-API-Key` secret is transmitted unencrypted between GitHub Actions runners and the EC2 instance (and between Kiro agent machines and EC2). Anyone on the network path can capture the API key and replay calls to the MCP server. | F-01 §2.4, §2.5, §8.2; F-02 §6.1–6.3; F-03 §4.4 | Add TLS. Options in ascending effort: (a) terminate TLS with an AWS ACM certificate on an ALB in front of EC2 (~$16/mo incremental, recommended even for POC); (b) self-signed cert on EC2 with the cert pinned in the GitHub Secret and agent config; (c) use AWS Systems Manager Session Manager port-forwarding for agent connections and a GitHub Actions AWS OIDC role (removing public exposure entirely). At minimum, the API key cannot travel in plaintext — option (b) is the lowest-effort fix that eliminates plaintext transmission. |
| 2 | **High** | Secrets Management | `KIRO_GOV_MCP_API_KEY` and `KIRO_GOV_MCP_URL` are documented as stored in a `.env` file on developer machines (F-02 §6.3). There is no documented gitignore rule for this file, no mention of `.env.example` as a safe alternative, and no instruction to keep it out of source control. If committed, the API key and EC2 IP are exposed in the repository history. | F-02 §6.3 | (a) Explicitly document that `.env` is gitignored — add `.env` to the project's `.gitignore` and add a note in F-02 §6.3. (b) Provide a `.env.example` with placeholder values that IS committed. (c) Consider sourcing the API key from SSM at agent startup rather than from a local file (consistent with how the MCP server itself handles secrets). |
| 3 | **Medium** | Network / Attack Surface | EC2 security group inbound rule for port 3000 allows "Kiro agent IP / VPC CIDR" (F-01 §2.5), but Kiro agents run on developer laptops — not in a fixed IP or VPC. In practice this likely means a broad CIDR or `0.0.0.0/0` must be used, making port 3000 reachable from the public internet. The architecture doc acknowledges this only with a production note ("replace public IP with ALB + WAF or VPC PrivateLink for production") without addressing the POC exposure. | F-01 §2.5, §8.2 | Explicitly document the actual inbound rule that will be applied for developer laptop access. If developer IPs are known (e.g., office egress IP, VPN exit IP), use those CIDRs. If IPs are dynamic, document the accepted risk and add a compensating control: (a) rate-limit at the application layer (already partially addressed by API key); (b) add a CloudWatch alarm on unusual request volume; (c) restrict port 3000 to SSH tunnel access only (developers forward via `ssh -L 3000:localhost:3000 ec2-user@<ip>`) — this removes the public port entirely. |
| 4 | **Medium** | IAM / Dead Credential Surface | F-04 §6.1 Role 2 (`kiro-gov-github-actions-role`) is an OIDC-federated IAM role with `dynamodb:PutItem` and `dynamodb:Query` permissions, provisioned in CDK but documented as unused ("GitHub Actions calls the MCP server HTTP endpoint, not DynamoDB directly"). An unused IAM role with DynamoDB write permissions is unnecessary attack surface — if any process obtains the GitHub Actions OIDC token it could write directly to the DynamoDB table, bypassing the MCP server's deduplication and validation logic. | F-04 §6.1 Role 2, F-04 §7.1 CDK | Remove `kiro-gov-github-actions-role` from the CDK stack. The role serves no function in the documented architecture. If future direct-write capability is ever needed, create it at that time. |
| 5 | **Medium** | Authentication / Trust Boundary | The Kiro agent MCP connection relies on the `X-API-Key` header for authentication. However, F-01 §2.5 shows the inbound rule for agent access is based on "Kiro agent IP / VPC CIDR" (network-layer trust) — any process running on a machine within that CIDR that knows the API key can call any MCP tool. There is no per-caller identity, no audit of which agent invoked a tool, and no way to revoke access for a specific agent without rotating the shared key for all callers. | F-01 §2.5, §7.1; F-02 §6.2–6.3 | For a POC, document this as an accepted risk with a stated rationale. Add a note that the `actor` field in `record_progress` is caller-supplied and unverified — it is an audit annotation, not an authenticated identity. If the team wants stronger per-caller isolation, consider per-agent API keys stored in SSM (one parameter per agent). |
| 6 | **Medium** | Secrets Management | GitHub Actions workflow does not have an explicit `permissions:` block in the YAML (F-03 §2.3). The workflow will inherit the repository's default GITHUB_TOKEN permissions. If the repository has been configured with permissive defaults (e.g., `read-write` on contents), the workflow token has more privileges than needed. | F-03 §2.3 | Add a `permissions:` block to the workflow YAML scoping to the minimum required. The workflow only needs to read repository contents (for checkout and diff). Add: `permissions: contents: read` at the job or workflow level. |
| 7 | **Low** | Data Security | DynamoDB table `kiro-governance-tracker` uses the CDK default encryption (`TableEncryption.DEFAULT`), which is AWS-owned keys — not customer-managed KMS keys. This means the team has no key management control and cannot independently audit key usage via CloudTrail KMS events. For internal developer tooling with no PII, this is acceptable; however it is undocumented as a deliberate choice. | F-04 §7.1 CDK | Document the encryption choice explicitly in F-04 §2.1 Table Configuration: add a row "Encryption: AWS-owned key (default) — `Architect decision`: no PII stored, CMK not required for POC." No code change required. |
| 8 | **Low** | Logging / Sensitive Data | The `notify_slack` error handler returns `{ notified: false, reason: 'ssm_param_not_found: /kiro-governance/slack/webhooks/<project_id>' }` to the MCP caller (F-01 §3.1). This path is also likely emitted in the CloudWatch structured log. While this exposes the SSM parameter path (not the webhook URL value), it could aid an attacker in enumerating valid project IDs by observing which paths return "not found" vs. other errors. | F-01 §3.1, §9.1, §9.2 | Replace the SSM path in the externally returned error reason with a generic message: `'webhook_not_configured'`. Log the full SSM path internally (CloudWatch) for debugging, but do not return it to the MCP caller. |
| 9 | **Low** | Audit & Logging | The `actor` field written to DynamoDB (and used for Slack notifications) is entirely caller-supplied and unverified. A sub-agent or GitHub Actions workflow can claim any actor identity. The audit trail is informational only. This is not documented as a known limitation. | F-01 §3.2, F-02 §3.3, F-03 §4.2 | Document explicitly in F-01 §3.2 and F-02 §3.3: "The `actor` field is caller-supplied and unverified. It is an audit annotation, not an authenticated identity. For the POC, this is accepted." This is a documentation fix, not a code change. |
| 10 | **Low** | IAM / GitHub Actions OIDC | F-04 §6.1 Role 2 trust policy is documented as "GitHub OIDC provider (repository-scoped)" but the specific OIDC condition (e.g., `token.actions.githubusercontent.com:sub` condition matching the specific repository) is not shown in the trust policy JSON. Without the `sub` condition, any GitHub repository in the same organisation could assume this role. | F-04 §6.1 Role 2 | Moot if finding #4 is accepted (role should be removed). If role is retained, add the `StringLike` condition on `token.actions.githubusercontent.com:sub`: `repo:<org>/<repo>:ref:refs/heads/main`. |
| 11 | **Info** | Network | The EC2 Elastic IP is treated as sensitive (stored in GitHub Secret `MCP_SERVER_URL`), but the architecture docs reference it in plaintext in multiple places (F-01 §8.2, F-02 §6.1). For an internal POC with no public DNS, obscuring the IP in GitHub Secrets while referencing it in docs provides limited security value but is not a risk in itself. | F-01 §8.2; F-02 §6.1 | No action required. Noted for awareness: the IP obscurity through GitHub Secrets provides minimal security benefit beyond keeping it out of workflow logs. |
| 12 | **Info** | Observability | CloudWatch log group `/kiro-governance/mcp-server` has 30-day retention. No mention of log export or archival if the EC2 instance is terminated. Logs would be lost when the log group is deleted. | F-01 §9.2 | No action required for POC. Note for production: if the EC2 instance is terminated and the stack torn down, CloudWatch log groups are not automatically deleted — logs persist for the configured retention period. Document this as accepted behaviour for POC. |

---

## Summary by Focus Area

| Area | Status | Key Findings |
|------|--------|--------------|
| IAM & Least Privilege | ⚠️ Gaps | #4 (unused role with DDB write perms), #10 (OIDC condition incomplete) |
| Secrets Management | ⚠️ Gaps | #2 (.env not explicitly gitignored), #6 (workflow permissions not scoped) |
| Network Security | ❌ Blockers | #1 (plain HTTP — API key in clear text), #3 (port 3000 public exposure underdocumented) |
| Data Security | ✅ Pass | S3 encrypted + Block Public Access ✅; DynamoDB default encryption documented gap (#7, Low) |
| Authentication & Authorization | ⚠️ Gaps | #5 (shared API key, no per-caller identity), #1 (key transmitted in plaintext) |
| Audit & Logging | ⚠️ Gaps | #8 (SSM path in error response), #9 (actor field unverified, undocumented) |

---

## Verdict

# ❌ CHANGES REQUIRED

**Blocking findings (must be resolved before proceeding to data model):**

- **Finding #1 (High):** Plain HTTP transmits the API key in clear text. The MCP server must use TLS or an alternative that prevents key interception.
- **Finding #2 (High):** `.env` file containing the API key is not documented as gitignored. Risk of accidental secret commit to repository.

**Non-blocking findings (should be resolved in same session as High fixes):**

- #3 (Medium) — Document actual inbound CIDR for developer laptop access
- #4 (Medium) — Remove unused `kiro-gov-github-actions-role` from CDK stack
- #5 (Medium) — Document shared API key limitation as accepted risk
- #6 (Medium) — Add `permissions: contents: read` to GitHub Actions workflow YAML
- #7 (Low) — Document DynamoDB encryption choice in F-04 §2.1
- #8 (Low) — Replace SSM path in external error response with generic message
- #9 (Low) — Document `actor` as unverified annotation in F-01 and F-02
- #10 (Low) — Moot if #4 accepted; otherwise add OIDC `sub` condition

---

## Required Actions Before Re-Review

The architect must resolve **Finding #1 and Finding #2** and update the affected architecture docs (F-01, F-02, F-03). Re-review is required only for the High findings. Medium and Low findings may be resolved concurrently or tracked as accepted risks with documented rationale.

| Finding | Doc(s) to Update | Nature of Change |
|---------|-----------------|-----------------|
| #1 | F-01 §2.4, §2.5, §8.2; F-02 §6.1–6.3; F-03 §4.4 | Architecture change: add TLS |
| #2 | F-02 §6.3 | Documentation + gitignore file addition |
| #3 | F-01 §2.5 | Documentation: specify actual developer CIDR or document accepted risk |
| #4 | F-04 §6.1, §7.1 | CDK code change: remove unused role |
| #5 | F-01 §3.2; F-02 §3.3 | Documentation: accepted risk statement |
| #6 | F-03 §2.3 | YAML change: add `permissions:` block |
| #7 | F-04 §2.1 | Documentation: add encryption row |
| #8 | F-01 §3.1 | Code change: generic external error, detailed internal log |
| #9 | F-01 §3.2; F-02 §3.3 | Documentation: unverified actor note |

---

*Security Gate 1 — v1.0 — 2026-06-11*


---

## Round 2 Re-check

**Date:** 2026-06-11
**Reviewer:** security-reviewer (security-gate-1-recheck)
**Docs reviewed:** F-01 v1.2, F-02 v1.2, F-03 v1.2, F-04 v1.3
**Scope:** Verify resolution of all 12 Round 1 findings; fresh scan for new Critical/High issues introduced by TLS changes.

---

### Finding-by-Finding Verification

| # | Severity | Finding | Status | Evidence |
|---|----------|---------|--------|----------|
| 1 | **High** | Plain HTTP → API key in cleartext | ⚠️ **PARTIALLY RESOLVED** | F-01 §2.4 documents HTTPS on port 443 with self-signed cert ✅. F-02 §6.2 `mcp.json` includes `tlsCertFingerprint` field using `${MCP_CERT_FINGERPRINT}` env var ✅. F-03 workflow YAML passes `MCP_CERT_FINGERPRINT` as an env var to the runner ✅. **BUT:** The `callMcpTool()` function in F-03 §3.4 uses plain `fetch()` with `NODE_TLS_REJECT_UNAUTHORIZED=0` and **never reads or validates `MCP_CERT_FINGERPRINT`**. The env var is dead code in the script — any certificate is accepted. The documented fingerprint pinning is not implemented. See new finding NEW-1 below. |
| 2 | **High** | `.env` not documented as gitignored | ✅ **RESOLVED** | F-02 §6.3 explicitly states: "The `.env` file **must** be listed in `.gitignore`." A `.env.example` with placeholder values is documented and provided. |
| 3 | **Medium** | Port 3000 public exposure underdocumented | ✅ **RESOLVED** | F-01 §2.5 now documents port 443 open to `0.0.0.0/0` with explicit rationale (GitHub Actions dynamic IPs), accepted risk statement, and production upgrade path. Port 3000 is no longer referenced — traffic migrated to 443 with TLS. |
| 4 | **Medium** | Unused `kiro-gov-github-actions-role` with DynamoDB write perms | ✅ **RESOLVED** | F-04 §6.1 now lists only 3 roles (MCP Server EC2 role, Athena connector role, QuickSight role). `kiro-gov-github-actions-role` is absent from both the IAM section and the CDK stack in §7.1. Changelog v1.3 confirms removal. |
| 5 | **Medium** | Shared API key — no per-caller identity, undocumented risk | ✅ **RESOLVED** | F-01 §7.1 now contains explicit accepted-risk statement: "The shared API key provides no per-caller identity… The `actor` field is caller-supplied and unverified — it is an audit annotation, not an authenticated identity. Accepted risk for POC." |
| 6 | **Medium** | No `permissions:` block in GitHub Actions workflow YAML | ✅ **RESOLVED** | F-03 §2.3 workflow YAML now contains `permissions: contents: read` at the workflow level, above the `jobs:` key. |
| 7 | **Low** | DynamoDB encryption choice undocumented | ✅ **RESOLVED** | F-04 §2.1 Table Configuration table now includes `Encryption: AWS-owned CMK (default)` with architect-decision note: "No PII/PHI in governance records. Upgrade to customer-managed CMK if compliance is required later." |
| 8 | **Low** | SSM path returned in external error response | ✅ **RESOLVED** | F-01 §3.1 `handleNotifySlack` now logs `ssmPath` to `console.error` internally and returns `{ notified: false, reason: 'webhook_not_configured' }` — the SSM path is never returned to the MCP caller. |
| 9 | **Low** | `actor` field unverified — not documented | ✅ **RESOLVED** | F-01 §7.1 documents the limitation. F-02 does not have an explicit note in §3.3 per the original requirement, but the cross-doc coverage in F-01 §7.1 and §3.2 context is sufficient. Accepted. |
| 10 | **Low** | OIDC `sub` condition not shown on GitHub Actions role | ✅ **RESOLVED (MOOT)** | Role removed per finding #4. |
| 11 | **Info** | EC2 IP in docs while treated as secret in GitHub Secrets | ✅ **No change required** | Acknowledged in original review. Consistent with v1.2 docs. |
| 12 | **Info** | CloudWatch log group retention / log loss on EC2 termination | ✅ **No change required** | F-01 §9.2 30-day retention is documented. No action required for POC. |

---

### New Findings from Fresh Scan (TLS-Change Scope)

| # | Severity | Area | Finding | Affected Doc / Section | Required Fix |
|---|----------|------|---------|------------------------|--------------|
| NEW-1 | **High** | Encryption in Transit / TLS | `callMcpTool()` in F-03 §3.4 sets `NODE_TLS_REJECT_UNAUTHORIZED=0` and never reads `MCP_CERT_FINGERPRINT`. The fingerprint variable is injected into the runner environment (workflow YAML §2.3 env block) but is dead code in the script — zero lines in the script body reference it. The net effect is that **any TLS certificate is accepted**: the connection is encrypted but not authenticated. A MITM attacker could substitute their own certificate and intercept the API key and all tool call payloads. The HIGH-1 fix documented in the changelog is only half-done — TLS encryption is present, but certificate pinning is absent in the implementation. | F-03 §3.4 `callMcpTool()`, F-03 §4.4 | The `callMcpTool()` function must implement fingerprint verification before the `fetch()` call. Because `fetch()` (global or node-fetch) does not expose `getPeerCertificate()`, use Node.js `https.request()` with a custom `checkServerIdentity` callback instead: (1) read `process.env.MCP_CERT_FINGERPRINT`; (2) in `checkServerIdentity`, call `cert.fingerprint256`, strip colons, compare against the stored value; (3) throw if mismatch. Until this is implemented, the self-signed cert approach provides encryption without authentication — which is weaker than the original plain-HTTP + network-layer controls because it creates false confidence. |

---

### Summary of Round 2 Status

| Category | Count | Status |
|----------|-------|--------|
| Round 1 High findings resolved | 2/2 (HIGH-1 partial — see NEW-1) | ⚠️ |
| Round 1 Medium findings resolved | 4/4 | ✅ |
| Round 1 Low findings resolved | 3/3 | ✅ |
| Round 1 Info findings | 2/2 — no action required | ✅ |
| New High findings introduced | 1 (NEW-1) | ❌ |

---

### Verdict

## ❌ CHANGES REQUIRED

**Blocking finding (must be resolved before Gate 1 can be approved):**

- **NEW-1 (High):** `callMcpTool()` in F-03 §3.4 does not implement the documented fingerprint verification. `NODE_TLS_REJECT_UNAUTHORIZED=0` with no cert validation is equivalent to HTTP from an authentication standpoint — the API key is encrypted in transit but the server identity is not verified. The fix requires replacing `fetch()` with `https.request()` and adding a `checkServerIdentity` callback that compares `cert.fingerprint256` against `process.env.MCP_CERT_FINGERPRINT`.

**Required action before Round 3:**

| Finding | Doc to Update | Change |
|---------|--------------|--------|
| NEW-1 | F-03 §3.4 | Replace `fetch()` in `callMcpTool()` with `https.request()` including fingerprint check implementation |

All Round 1 findings except HIGH-1 (partially blocked by NEW-1) are resolved. Round 3 re-check is scoped to NEW-1 only.

---

*Security Gate 1 — Round 2 Re-check — 2026-06-11*

---

## Round 3 Final

**Date:** 2026-06-11
**Reviewer:** security-reviewer (security-gate-1-final)
**Doc reviewed:** F-03 v1.3 (`github-trigger-architecture.md`)
**Scope:** Verify NEW-1 resolution only; fresh scan for new Critical/High issues.

---

### NEW-1 Verification

| Check | Result | Evidence |
|-------|--------|----------|
| `callMcpTool()` uses `https.request()` (not `fetch()`) | ✅ **CONFIRMED** | F-03 §3.4 line: `const req = https.request({ host, port, path: '/mcp', …, checkServerIdentity: … })`. `fetch()` is absent from the script body — it appears only in the changelog as historical context of what was removed. |
| `checkServerIdentity` callback present | ✅ **CONFIRMED** | Callback reads `cert.fingerprint256`, assigns it to `actual`, compares against `certFingerprint`. Returns `new Error(...)` on mismatch; returns `undefined` on match (Node.js convention for OK). |
| Comparison uses `cert.fingerprint256` vs `process.env.MCP_CERT_FINGERPRINT` | ✅ **CONFIRMED** | `const certFingerprint = process.env.MCP_CERT_FINGERPRINT;` (line 205); `const actual = cert.fingerprint256;` inside callback; `if (actual !== certFingerprint) return new Error(…)`. Format matches: Node.js colon-delimited hex (e.g. `AA:BB:CC:…`), consistent with the `openssl` extraction command documented in §4.4. |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` removed from workflow YAML | ✅ **CONFIRMED** | The env block in §2.3 contains only `MCP_SERVER_URL`, `MCP_API_KEY`, `MCP_CERT_FINGERPRINT`, `PROJECT_ID`, `ACTOR`, `SOURCE_REF`. `NODE_TLS_REJECT_UNAUTHORIZED` does not appear anywhere in the YAML. |
| `MCP_CERT_FINGERPRINT` secret wired end-to-end | ✅ **CONFIRMED** | Declared in workflow env (§2.3), read by script (`process.env.MCP_CERT_FINGERPRINT`), documented as a GitHub Encrypted Secret in §4.5 and §6.1. |

**NEW-1 verdict: RESOLVED ✅**

---

### Fresh Scan — New Critical/High Issues

| Check | Result |
|-------|--------|
| Any `fetch()` with TLS bypass in script body | ✅ Clean — `fetch()` absent from script |
| Any `NODE_TLS_REJECT_UNAUTHORIZED` in YAML or script | ✅ Clean — absent from both |
| `execSync` command injection risk | ✅ Clean — command is a fixed string (`git diff HEAD~1 HEAD -- docs/project-progress.md`); no user-controlled interpolation |
| New secrets exposed in code or YAML | ✅ Clean — all secrets via `process.env` sourced from GitHub Encrypted Secrets |
| Any new public endpoint, IAM role, or service introduced | ✅ None — v1.3 is a pure implementation fix; no architectural additions |

**No new Critical or High issues introduced in v1.3.**

---

## Verdict

# ✅ APPROVED

All Round 1 High/Medium/Low findings are resolved. NEW-1 is resolved. No new Critical or High issues introduced. F-03 is cleared for Gate 1 passage.

**Gate 1 overall status:** All five feature docs (F-01 through F-05) have passed security review. The architect may proceed to Step 4 — Unified Data Model.

---

*Security Gate 1 — Round 3 Final — 2026-06-11*
