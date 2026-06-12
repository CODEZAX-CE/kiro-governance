# Feature List — `kiro_governance`

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.2 | AWS Architect | CR 2026-06-11: Removed F-05 (Reporting). F-04 scope reduced to DynamoDB only. |
| 2026-06-11 | v1.1 | AWS Architect | Fix architecture doc paths to use `docs/phase1/` prefix; FR-02 owned solely by F-01, FR-08 owned solely by F-05; F-04 explicitly marked as shared infrastructure exception (plan reviewer findings) |
| 2026-06-11 | v1.0 | AWS Architect | Initial feature list derived from SRS v1.5 and domain decomposition v1.0 |

---

## 1. Feature List

| Feature ID | Name | Domain | SRS FRs | Description | Architecture Doc (Step 2.3) |
|---|---|---|---|---|---|
| F-01 | MCP Server — Tools, Classification & Deduplication | MCP Server Core | FR-01, FR-02, FR-03, FR-09 | EC2-hosted MCP server exposing two tools (`notify_slack`, `record_progress`), inline macro/micro auto-classification engine (10 canonical gates), `flag_override` support, and idempotency-key-based deduplication to prevent dual-trigger duplicates. Includes SSM Parameter Store reads for webhook URL resolution. | `docs/phase1/mcp-server-core-architecture.md` |
| F-02 | Agent Integration — Human-Approval Gate & Orchestrator Hook | Agent Integration | FR-05, FR-06, FR-07 | Explicit human-approval gate added to Kiro app-dev agent workflow (branch + PR). On macro approval, orchestrator hook fires both MCP tools (Slack + DB). Sub-agents call MCP `record_progress` directly for micro events (no gate, no Slack). | `docs/phase1/agent-integration-architecture.md` |
| F-03 | GitHub Actions Governance Trigger | GitHub Trigger | FR-04 | `.github/workflows/governance-trigger.yml` — triggers on `project-progress.md` changes pushed to `main`. Extracts diff, applies macro-gate lingo matching, calls MCP server HTTP endpoint for macro events only. Micro entries ignored. Uses `fetch-depth: 2` and API key auth. | `docs/phase1/github-trigger-architecture.md` |
| F-04 | DynamoDB Table | Data & Persistence | — (shared infrastructure) | DynamoDB single-table (`kiro-governance-tracker`) with PK/SK design, GSI on `type`/`gate` for cross-project queries. **Shared infrastructure** required by FR-02 (write target via F-01) only. | `docs/phase1/data-persistence-architecture.md` |

---

## 2. FR Coverage Check

| FR | Title | Mapped to Feature | Status |
|----|-------|-------------------|--------|
| FR-01 | MCP Server — Slack Notification Tool | F-01 | ✅ |
| FR-02 | MCP Server — DynamoDB Write Tool | F-01 | ✅ |
| FR-03 | Macro/Micro Auto-Classification | F-01 | ✅ |
| FR-04 | GitHub Actions Workflow — Parse `project-progress.md` | F-03 | ✅ |
| FR-05 | Orchestrator Hook — Macro Sign-Off Capture | F-02 | ✅ |
| FR-06 | Human-Approval Gate in Kiro Agents | F-02 | ✅ |
| FR-07 | Micro Update Logging (No Human Gate) | F-02 | ✅ |
| FR-08 | Dashboard — Cross-Project Status Reporting | Out of scope (DynamoDB table is delivery boundary) | ⚠️ Narrowed |
| FR-09 | Dual Trigger Path — Consistency (Deduplication) | F-01 | ✅ |

**Result: 8/9 FRs mapped. FR-08 narrowed to DynamoDB delivery boundary (out of scope per CR 2026-06-11). Zero features invented without SRS basis.**

---

## 3. Feature Dependency Order

```
F-04 (DynamoDB)                ← must exist before anything writes
  ↑
F-01 (MCP Server Core)        ← depends on F-04 (writes to DynamoDB)
  ↑            ↑
F-02 (Agent)   F-03 (GitHub)  ← both depend on F-01 (call MCP tools)
```

**Build order:** F-04 → F-01 → F-02 + F-03 (parallel)

---

## 4. Notes

1. **F-01 is the largest feature** — it contains the MCP server runtime, both tool implementations, classification logic, and dedup. This is intentional: these components are tightly coupled (classification runs inline during every tool call, dedup is checked at write time) and belong in one architecture doc.

2. **F-04 has no directly-owned FR** but is a discrete buildable unit (table creation, GSI design). It is **shared infrastructure** required by FR-02 (write target via F-01). This is an accepted exception for infrastructure layers that enable but do not own FRs.

3. **FR-02 is owned solely by F-01** — the tool logic (validation, PutItem call) lives in F-01. F-04 provides the underlying table infrastructure but does not own the FR.

4. **Classification logic is shared** between F-01 (MCP server) and F-03 (GitHub Action). The architecture docs must specify how the canonical gate list is shared (config file, constant, or duplicated with tests ensuring parity).

---

*End of Feature List v1.2*
