# Architect Review — SRS v1.0 (Round 1)

**Reviewer:** AWS Architect
**Date:** 2026-06-10
**SRS Version:** v1.0
**Verdict:** ⚠️ **CHANGES REQUIRED**

---

## Summary

The SRS is well-structured and maintains strong traceability to the project brief. The macro/micro model, DynamoDB schema, MCP server tools, and Pathway 2 exclusion are all correctly captured. However, there are several findings that must be resolved before approval — most critically, a missing macro gate from the brief, and the GitHub trigger mechanism needs an architectural decision recorded in the SRS.

---

## Findings

### FINDING-01 — Missing Macro Gate: "Discovery outputs / Preliminary SRS validated"

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Affected Section** | §15 (Canonical Macro Gates Reference), FR-03 |
| **Description** | The brief §4a lists the first Phase 1 gate as "Discovery outputs / **Preliminary SRS validated**". The SRS §15 truncates this to just "Discovery outputs validated", dropping the "Preliminary SRS" component. This means the macro-gate lingo matching in FR-03 may not recognise "preliminary SRS validated" as a macro event. |
| **Required Fix** | Update §15 row 1 to match the brief exactly: "Discovery outputs / Preliminary SRS validated". Ensure FR-03's matching list includes both "discovery outputs validated" and "preliminary SRS validated" as macro triggers. |

---

### FINDING-02 — No Architectural Decision Recorded for GitHub Trigger Mechanism

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Affected Section** | §11, FR-04 |
| **Description** | The SRS correctly flags the GitHub trigger as UNVERIFIED (§11) and lists three options, but does NOT record the architect's recommendation or decision. Per §15 of the architect standards, an architectural decision must be present before the SRS is approved. See the **Architectural Recommendation** section below for the decision to incorporate. |
| **Required Fix** | Add the architect's recommendation (GitHub Actions workflow — see below) as an **Architect Decision** in §11, changing its status from "open question" to "resolved — architect decision". Update FR-04 to remove the UNVERIFIED marker and specify GitHub Actions as the implementation mechanism. |

---

### FINDING-03 — Deduplication Mechanism Undefined

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Affected Section** | FR-09 |
| **Description** | FR-09 correctly identifies the dual-trigger deduplication need but defers the mechanism entirely to "architect to design." This is acceptable for an open question, but since this is a core consistency requirement, at minimum the SRS should specify the **expected behaviour** (idempotent writes) and the **deduplication key strategy** — even if the exact implementation is deferred to architecture. Without this, FR-09's AC is not testable: "produce only ONE DynamoDB record" has no defined mechanism for a tester to verify. |
| **Required Fix** | Add a concrete deduplication key strategy to FR-09 AC. Recommend: use a deterministic idempotency key composed of `PROJECT#<project_id> + gate + date (day-granularity)` — if a record with the same PK/gate/date already exists, the write is skipped. Mark this as `Architect decision — not customer-specified`. |

---

### FINDING-04 — FR-03 Lists Only 8 Macro Gates (Missing "Project documentation approved")

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Affected Section** | FR-03 Acceptance Criteria |
| **Description** | FR-03's AC bullet list of canonical macro gates to match lists 8 items. The brief §4a specifies 9 gates (splitting "Runbooks / documentation approved" and "Project documentation approved" as separate Phase 4 gates). The SRS §15 correctly lists all 9, but FR-03's inline list conflates them into one bullet: `"runbooks approved" / "documentation approved"`. "Project documentation approved" is absent from FR-03. |
| **Required Fix** | Add "project documentation approved" as a separate bullet in FR-03's matching list. Ensure it is distinct from "runbooks approved" / "documentation approved". |

---

### FINDING-05 — OQ-05 Answer Is in the Brief

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Affected Section** | §11 — Open Questions |
| **Description** | OQ-05 asks "Should the GitHub trigger also process micro events, or only macro?" The brief §3 step 5 explicitly states: "if project-progress.md changed with **macro-gate lingo**, it verifies the gate was completed and runs the same two steps." This implies the GitHub path is macro-only. Additionally, FR-07 states micro events are logged "via the MCP server" by the sub-agent directly — not via the GitHub path. This question is answerable from the brief and should be resolved, not left open. |
| **Required Fix** | Resolve OQ-05 with answer: "GitHub trigger processes macro events only. Micro events are logged directly by sub-agents via the MCP server DynamoDB tool (FR-07)." Move to resolved questions or remove from open questions. |

---

### FINDING-06 — NFR-01 Performance Target Too Vague

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Affected Section** | §9 NFR-01 |
| **Description** | NFR-01 states "complete within a reasonable time" which is not testable. While the brief doesn't specify a latency target, for an internal POC the SRS should at minimum state a sanity bound (e.g., p95 < 5s for MCP tool response). The existing note correctly labels this as an architect decision pending confirmation. |
| **Required Fix** | Add a concrete target: `Architect decision: MCP tool invocations shall complete in < 5s p95 (EC2-to-DynamoDB + Slack webhook).` This is generous for a POC and can be tightened later. |

---

### FINDING-07 — `flag_override` Semantics Incomplete in FR-03

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Affected Section** | FR-03 |
| **Description** | The brief states the override can "set or correct the classification." FR-03's AC says: "Given a record with `flag_override` = `true` and an explicit `type` value provided by the caller, then the caller-provided `type` takes precedence." This conflates two things: (1) `flag_override` as a boolean flag, and (2) the caller providing an explicit `type`. The schema shows `flag_override` as `true/null` — it doesn't carry the corrected value; the corrected value is in `type`. The AC should clarify: when `flag_override` = `true`, the `type` field is treated as manually set (not auto-classified), regardless of what the `update_text` contains. |
| **Required Fix** | Rewrite the `flag_override` AC to: "Given a tool call with `flag_override` = `true`, then the `type` value provided by the caller is stored as-is (no auto-classification is performed). The `flag_override` field serves as an audit marker indicating the classification was manually set." |

---

### FINDING-08 — Dashboard FR Lacks Source Traceability for Specific Features

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Affected Section** | FR-08 |
| **Description** | FR-08 correctly notes that dashboard details beyond "cross-project status" and "reporting" are UNVERIFIED. However, the AC still specifies "Filter by: project, gate, phase, type" without marking these as architect/implementation decisions. These filtering capabilities are reasonable but not stated in the brief. |
| **Required Fix** | Mark the filter capabilities in FR-08 AC as `Architect decision — not customer-specified` to maintain traceability discipline. |

---

## Architectural Recommendation — GitHub Trigger Mechanism

### Context

The brief references a "GitHub agent" reading `project-progress.md` on commit. GitHub Copilot Agents (`github.com/features/copilot/agents`) are a separate product — NOT part of the Kiro agent team and NOT suitable for this use case. The brief itself acknowledges this flexibility in §6: "The GitHub-side parse step (reading `project-progress.md` on commit) can still run as a **GitHub Action** or as a process alongside the MCP server on the EC2 box."

### Options Evaluated

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **(a) GitHub Actions workflow** | `.github/workflows/governance.yml` triggers on push to `main` when `project-progress.md` changes. Workflow diffs the file, classifies entries, calls MCP server via HTTP. | Well-documented; no infra to manage; runs in GitHub's infra; easy to test/debug; natively triggers on file changes; free for private repos (2,000 min/mo). | Adds a network hop to EC2; requires MCP server to expose an HTTP endpoint (it already does as an EC2-hosted server). |
| **(b) Webhook listener on EC2** | GitHub sends a `push` webhook to a listener on the EC2 instance. Listener fetches the diff via GitHub API, parses, and calls MCP tools locally. | Co-located with MCP server (no network hop); single infrastructure. | More operational burden (must manage webhook secret, TLS, port exposure); makes EC2 a public-facing endpoint; complicates security. |
| **(c) Kiro post-commit hook** | A local git hook or Kiro CLI hook fires after commit and performs the parse/notify. | Keeps everything in Kiro's domain; no GitHub infra dependency. | Only fires on the developer's machine (not on merges by others); doesn't work for CI/CD merges; fragile (hooks can be skipped). |

### Recommendation: Option (a) — GitHub Actions Workflow

**Decision:** Use a GitHub Actions workflow.

**Rationale:**
1. **The brief explicitly supports this option** (§6: "can still run as a GitHub Action").
2. **Zero additional infrastructure** — no public endpoint on EC2, no webhook secret management.
3. **Natively triggers on file changes** — `paths: ['docs/project-progress.md']` filter is built-in.
4. **Reliable** — fires on all pushes/merges, not just local commits.
5. **Testable** — workflow runs are visible in GitHub Actions UI with full logs.
6. **Cost** — free within GitHub's included minutes for private repos.

**Trade-offs:**
- Adds a network call from GitHub Actions runner → EC2 MCP server (acceptable; sub-second latency).
- Requires the MCP server to be reachable from GitHub's IP ranges (EC2 security group must allow inbound from GitHub Actions IPs, or use a GitHub-hosted runner with VPN/PrivateLink — overkill for POC; simple IP allowlist is fine for internal tooling).

**Implementation sketch:**
```yaml
# .github/workflows/governance-trigger.yml
on:
  push:
    branches: [main]
    paths: ['docs/project-progress.md']
jobs:
  governance-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - name: Diff project-progress.md
        run: git diff HEAD~1 -- docs/project-progress.md > diff.txt
      - name: Parse and classify
        run: # Script that reads diff, matches macro-gate lingo, calls MCP server
```

**Security note:** The EC2 MCP server should validate an API key/shared secret in the request from GitHub Actions to prevent unauthorized calls. Store the secret in GitHub Actions secrets and pass it as a header.

---

## Checklist Assessment

### Traceability ✅ (with minor fixes)
- [x] Every FR has a `Source:` tag citing a real section of the project brief
- [x] Every AC bullet is either customer-stated or labeled as implementation/architect decision
- [ ] **PARTIAL** — FR-08 filter ACs not labeled as architect decisions (FINDING-08)

### Completeness ✅ (with minor fixes)
- [x] All components covered: MCP server (2 tools), DynamoDB, GitHub trigger, Slack, orchestrator hook, human-approval gate, dashboard
- [x] Pathway 2 correctly scoped OUT (§4.2)
- [x] Dual trigger path captured (FR-05 + FR-04, unified in FR-09)
- [x] Macro/micro classification model captured (§5.2, FR-03)
- [ ] **PARTIAL** — 8 of 9 macro gates in FR-03 (FINDING-04); all 9 in §15

### AC Quality ⚠️ (fixes needed)
- [ ] FR-09 deduplication AC not testable without mechanism (FINDING-03)
- [ ] FR-03 `flag_override` AC conflates semantics (FINDING-07)
- [x] All other ACs are machine-testable with specific field names and behaviours

### NFRs ✅ (with minor fix)
- [x] Performance, reliability, security, cost targets present
- [ ] **PARTIAL** — NFR-01 performance target not specific enough (FINDING-06)

### Consistency ✅
- [x] No contradictions between FRs
- [x] DynamoDB schema matches brief §6 (PK, SK, update_text, type, flag_override, gate, phase, source_ref, actor, created_at, GSI on type/gate)

### Open Questions ✅ (with fixes)
- [x] GitHub Agent mechanism properly flagged as UNVERIFIED with alternatives
- [ ] **PARTIAL** — Deduplication addressed in FR-09 but mechanism undefined (FINDING-03)
- [ ] **PARTIAL** — OQ-05 answerable from brief, should be resolved (FINDING-05)

---

## Required Fixes (for Product Analyst)

Before SRS can be approved, the following must be addressed:

| # | Finding | Action | Priority |
|---|---------|--------|----------|
| 1 | FINDING-02 | Add architect decision for GitHub Actions workflow in §11. Update FR-04 to specify GitHub Actions as the mechanism. Remove UNVERIFIED status. | **Must fix** |
| 2 | FINDING-03 | Add concrete deduplication key strategy to FR-09 (idempotency key: PK + gate + date). Mark as architect decision. | **Must fix** |
| 3 | FINDING-01 | Update §15 row 1 and FR-03 to include "Preliminary SRS validated" per brief. | Should fix |
| 4 | FINDING-04 | Add "project documentation approved" as separate entry in FR-03 matching list. | Should fix |
| 5 | FINDING-07 | Rewrite `flag_override` AC in FR-03 to clarify semantics. | Should fix |
| 6 | FINDING-05 | Resolve OQ-05 (GitHub trigger = macro-only). | Should fix |
| 7 | FINDING-06 | Add concrete p95 < 5s target to NFR-01. | Nice to have |
| 8 | FINDING-08 | Label FR-08 filter capabilities as architect decisions. | Nice to have |

---

## Decisions Made in This Review

These decisions should be incorporated into the SRS by the product analyst:

1. **GitHub trigger mechanism → GitHub Actions workflow** (see Architectural Recommendation above)
2. **Deduplication strategy → Idempotency key** (PK + gate + day-granularity date)
3. **GitHub path scope → Macro events only** (micro events logged directly by sub-agents)
4. **Performance target → p95 < 5s** for MCP tool invocations (POC-appropriate)

---

*Review complete. Returning to orchestrator for product analyst action.*
