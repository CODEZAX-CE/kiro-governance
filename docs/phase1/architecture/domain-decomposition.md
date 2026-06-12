# Domain Decomposition — `kiro_governance`

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.1 | AWS Architect | CR 2026-06-11: Removed Reporting domain. Data & Persistence domain scope reduced. |
| 2026-06-11 | v1.0 | AWS Architect | Initial domain decomposition from SRS v1.5 |

---

## 1. Overview

This document decomposes the `kiro_governance` system into bounded domains, maps every SRS functional requirement to its owning domain, and identifies cross-domain interfaces.

**System context:** Greenfield POC — governance gate and notification layer around Kiro's agentic output.

---

## 2. Domain Definitions

### Domain 1: MCP Server Core

**Responsibility:** Expose agent-callable MCP tools (Slack notification + DynamoDB write) and perform macro/micro auto-classification.

**Owns:**
- **FR-01** — Slack Notification Tool
- **FR-02** — DynamoDB Write Tool
- **FR-03** — Macro/Micro Auto-Classification
- **FR-09** — Dual Trigger Path Consistency (deduplication logic lives here)

**Interfaces with:**
| Domain | Direction | Data |
|--------|-----------|------|
| Agent Integration | Inbound | Tool call payload (`project_id`, `update_text`, `type`, `gate`, `phase`, `actor`, `source_ref`, `flag_override`) |
| GitHub Trigger | Inbound | Same tool call payload (from GitHub Actions HTTP call) |
| Data & Persistence | Outbound | DynamoDB PutItem (`PK`, `SK`, all attributes) |
| Notification | Outbound | Slack webhook POST (`project_id`, `message`) |

**Key components:**
- EC2 instance running MCP server (TypeScript/Node.js)
- MCP tool definitions: `notify_slack`, `record_progress`
- Classification engine (macro-gate lingo matcher per §4a)
- Idempotency check (dedup key: `PK` + `gate` + day-date)
- SSM Parameter Store reads (`/kiro-governance/slack/webhooks/{project_id}`)

---

### Domain 2: Agent Integration

**Responsibility:** Provide the human-approval gate in Kiro agent workflows and orchestrator hook that triggers governance recording on macro sign-off.

**Owns:**
- **FR-05** — Orchestrator Hook — Macro Sign-Off Capture
- **FR-06** — Human-Approval Gate in Kiro Agents
- **FR-07** — Micro Update Logging (No Human Gate)

**Interfaces with:**
| Domain | Direction | Data |
|--------|-----------|------|
| MCP Server Core | Outbound | MCP tool call payload (macro: both tools; micro: DB tool only) |

**Key components:**
- Kiro agent hook configuration (human-approval gate definition)
- Orchestrator hook logic (fires MCP tool calls on approval)
- Sub-agent micro-logging calls (direct MCP tool invocation, `type: micro`)
- Delivery: branch + PR into existing app-dev agents repository

---

### Domain 3: GitHub Trigger

**Responsibility:** Detect `project-progress.md` changes on commit/merge, parse diffs for macro-gate lingo, and invoke MCP server tools for matching events.

**Owns:**
- **FR-04** — GitHub Actions Workflow — Parse `project-progress.md` on Commit

**Interfaces with:**
| Domain | Direction | Data |
|--------|-----------|------|
| MCP Server Core | Outbound | HTTP call to MCP server with tool call payload (macro events only) |

**Key components:**
- `.github/workflows/governance-trigger.yml`
- Diff extraction logic (`fetch-depth: 2`, line-by-line parse)
- Macro-gate lingo matcher (mirrors FR-03 classification logic)
- GitHub Encrypted Secrets (MCP server API key)
- Path filter: `docs/project-progress.md` on push to `main`

---

### Domain 4: Data & Persistence

**Responsibility:** Store the append-only governance event log with support for cross-project queries.

**Owns:**
- No FR is solely owned here — this domain is the **shared infrastructure** that FR-02 writes to.

> Note: FR-02 (the write tool) is owned by MCP Server Core. This domain owns the **data layer** — the DynamoDB table and GSIs.

**Interfaces with:**
| Domain | Direction | Data |
|--------|-----------|------|
| MCP Server Core | Inbound (writes) | DynamoDB PutItem — full record schema (PK, SK, attributes) |

**Key components:**
- DynamoDB table: `kiro-governance-tracker` (single-table design)
  - PK: `PROJECT#<project_id>`, SK: `UPDATE#<ISO-timestamp>#<ulid>`
  - GSI on `type` and `gate` for cross-project queries

---

## 3. Cross-Domain Interface Table

| # | Interface | Producer | Consumer | Data Shape | Transport |
|---|-----------|----------|----------|-----------|-----------|
| 1 | Agent → MCP tool call (macro) | Agent Integration | MCP Server Core | `{ project_id, update_text, type: "macro", gate, phase, actor, source_ref }` | MCP protocol (stdio/HTTP) |
| 2 | Agent → MCP tool call (micro) | Agent Integration | MCP Server Core | `{ project_id, update_text, type: "micro", actor, source_ref }` | MCP protocol (stdio/HTTP) |
| 3 | GitHub Actions → MCP HTTP call | GitHub Trigger | MCP Server Core | `{ project_id, update_text, type: "macro", gate, actor, source_ref }` + API key header | HTTPS POST to EC2 |
| 4 | MCP Server → DynamoDB write | MCP Server Core | Data & Persistence | DynamoDB PutItem: `{ PK, SK, update_text, type, flag_override, gate, phase, source_ref, actor, created_at }` | AWS SDK (DynamoDB API) |
| 5 | MCP Server → Slack webhook | MCP Server Core | Slack (external) | `{ text, channel }` via incoming webhook URL | HTTPS POST |
| 6 | MCP Server → SSM read | MCP Server Core | AWS SSM (external) | GetParameter: `/kiro-governance/slack/webhooks/{project_id}` | AWS SDK |

---

## 4. FR Coverage Check

| FR | Title | Owning Domain | Status |
|----|-------|---------------|--------|
| FR-01 | MCP Server — Slack Notification Tool | MCP Server Core | ✅ Mapped |
| FR-02 | MCP Server — DynamoDB Write Tool | MCP Server Core | ✅ Mapped |
| FR-03 | Macro/Micro Auto-Classification | MCP Server Core | ✅ Mapped |
| FR-04 | GitHub Actions Workflow — Parse `project-progress.md` | GitHub Trigger | ✅ Mapped |
| FR-05 | Orchestrator Hook — Macro Sign-Off Capture | Agent Integration | ✅ Mapped |
| FR-06 | Human-Approval Gate in Kiro Agents | Agent Integration | ✅ Mapped |
| FR-07 | Micro Update Logging (No Human Gate) | Agent Integration | ✅ Mapped |
| FR-08 | Dashboard — Cross-Project Status Reporting | Data & Persistence (narrowed scope: data queryable by external consumers) | ⚠️ Narrowed |
| FR-09 | Dual Trigger Path — Consistency (Deduplication) | MCP Server Core | ✅ Mapped |

**Result: 8/9 FRs mapped. FR-08 narrowed to DynamoDB delivery boundary (out of scope per CR 2026-06-11). Zero domains invented without SRS basis.**

---

## 5. Domain Dependency Graph (Text)

```
┌─────────────────────┐       ┌──────────────────┐
│  Agent Integration  │──────▶│  MCP Server Core │
│  (FR-05,06,07)      │       │  (FR-01,02,03,09)│
└─────────────────────┘       └────────┬─────────┘
                                       │
┌─────────────────────┐                │
│   GitHub Trigger    │───────────────▶│
│   (FR-04)           │                │
└─────────────────────┘                │
                                       ▼
                              ┌──────────────────┐
                              │ Data & Persistence│
                              │   (DynamoDB)     │
                              └──────────────────┘
```

**Data flow:** Both Agent Integration and GitHub Trigger are **producers** that call MCP Server Core. MCP Server Core is the **mediator** that writes to Data & Persistence and notifies Slack.

---

## 6. Notes & Constraints

1. **Data & Persistence has no directly-owned FR** — it is shared infrastructure consumed by FR-02 (write). This is correct for a single-table DynamoDB design; it doesn't warrant its own FR since it has no independent user-facing behavior.

2. **Notification (Slack) is not a separate domain** — it collapses into MCP Server Core because the Slack webhook call is a simple outbound POST within the `notify_slack` tool. No independent routing, transformation, or queue is involved. If this POC evolves to add email, SMS, or other channels, Notification should be extracted into its own domain.

3. **Classification logic (FR-03) is co-located with MCP Server Core** because it runs inline during every tool call — it is not a separate service or async process.

4. **FR-09 (deduplication) is owned by MCP Server Core** because the idempotency check happens at write time within the `record_progress` tool, before the DynamoDB PutItem.

5. **GitHub Trigger mirrors the classification logic** from FR-03 to decide which entries are macro. The source-of-truth gate list must be shared (e.g., as a config file or constant imported by both the MCP server and the GitHub Action).

---

*End of Domain Decomposition v1.1*
