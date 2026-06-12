# KG-06 Implementation Spec: Human-Approval Gate & Orchestrator Integration

**Story ID:** KG-06  
**Feature:** F-02 — Agent Integration: Human-Approval Gate & Orchestrator Hook  
**Sprint:** Sprint 2  
**Status:** Spec (Ready for Implementation)  
**Author:** Backend Developer Agent  
**Date:** 2026-06-11  

---

## Executive Summary

This spec covers all changes required to add an explicit human-approval gate to the Kiro app-dev agent workflow at each of the 10 canonical macro gates, with orchestrator hook logic that calls the MCP server (F-01) to record governance events and notify Slack on approval.

**Deliverables:**
1. `.kiro/steering/orchestrator-standards.md` — Add Human-Approval Gate section
2. `.kiro/mcp.json` — Create MCP server connection config
3. Sub-agent steering files — Add micro-update logging instructions (7 files)
4. `.env.example` — Add placeholders for MCP connection env vars

**Story Arc:**  
F-02 §2, §3, §5 + F-01 §3 (tool schemas) + SRS §16 (canonical gates) + SRS FR-06 AC

---

## 1. Background & Context

### 1.1 The 10 Canonical Macro Gates (SRS §16)

All 10 gates are defined in `packages/shared/constants/macro-gates.ts` on the MCP server (F-01):

| # | Gate Name | Phase | Validating Agent |
|---|-----------|-------|------------------|
| 1 | Discovery outputs validated | Phase 1 | `product-analyst` |
| 2 | Preliminary SRS validated | Phase 1 | `product-analyst` |
| 3 | SRS approved | Phase 1 | `product-analyst` |
| 4 | Design docs approved | Phase 2 | `aws-architect` |
| 5 | Implementation plan approved | Phase 2 | `plan-reviewer` |
| 6 | Spec file approved | Phase 3 | `executioner` |
| 7 | Code approved | Phase 3 | `code-reviewer` |
| 8 | UAT report approved | Phase 3 | `qa-agent` |
| 9 | Runbooks approved | Phase 4 | `aws-architect` |
| 10 | Project documentation approved | Phase 4 | `aws-architect` |

> Source: SRS §16 "Canonical macro gates (from the methodology diagram)". All gate strings MUST match exactly (including capitalization and spacing).

### 1.2 MCP Tool Schemas (F-01 §3)

**Tool 1: `record_progress`**

Input schema (from F-01 §3.2):
```typescript
{
  project_id: string,           // GitHub repo name (e.g., "rainn")
  update_text: string,          // Human-readable event description
  type?: 'macro' | 'micro',     // Optional — auto-classified if omitted
  gate?: string,                // Canonical gate name (optional for micro)
  phase?: string,               // Phase number (optional)
  source_ref: string,           // Path to artifact or commit SHA
  actor: string,                // Human approver identity
  flag_override?: boolean       // Force explicit type (skip auto-classification)
}
```

Output: `{ written: boolean, pk?: string, sk?: string, reason?: string }`

**Tool 2: `notify_slack`**

Input schema (from F-01 §3.1):
```typescript
{
  project_id: string,
  message: string,
  event_type: 'macro' | 'micro'
}
```

Output: `{ notified: boolean, reason?: string }`

> Source: F-01 §3.1, §3.2 — Exact input/output shapes. Must not be modified.

### 1.3 Orchestrator Hook Trigger (F-02 §3)

The orchestrator hook fires **only on human approval** of a macro gate artifact. The flow:

1. Sub-agent produces artifact → Orchestrator presents it for human review
2. Human says "approve" → Orchestrator calls `record_progress` + `notify_slack` via MCP
3. Human says "reject" → Artifact returns to sub-agent, **no MCP calls fire**

> Source: F-02 §2.3, §2.4, §3.1

---

## 2. File: `.kiro/mcp.json` (NEW)

**Location:** Project root (same directory as `package.json`)  
**Status:** CREATE NEW  
**Purpose:** Configure MCP server connection for all agents

```json
{
  "mcpServers": {
    "kiro-governance": {
      "type": "remote",
      "url": "${KIRO_GOV_MCP_URL}",
      "headers": {
        "X-API-Key": "${KIRO_GOV_MCP_API_KEY}"
      },
      "tlsCertFingerprint": "${MCP_CERT_FINGERPRINT}"
    }
  }
}
```

**Rules:**
- Environment variables use `${VAR}` interpolation syntax (Kiro native)
- Never hardcode the EC2 IP, API key, or cert fingerprint in this file
- `.gitignore` must NOT exclude `.kiro/mcp.json` — the config structure is committed, values are env vars
- The Kiro runtime resolves `${...}` from environment variables at agent startup

> Source: F-02 §6.2

---

## 3. File: `.env.example` (NEW/MODIFIED)

**Location:** Project root  
**Status:** CREATE or MODIFY  
**Purpose:** Reference template for local dev + CI/CD setup  
**Note:** `.env` itself must be in `.gitignore` (secrets file); `.env.example` is committed

```bash
# MCP Server Connection (for governance recording)
# Get these values from:
#   - EC2 Elastic IP: EC2 console or `aws ec2 describe-addresses`
#   - API Key: AWS SSM Parameter Store `/kiro-governance/config/mcp-api-key`
#   - Cert Fingerprint: from EC2 /opt/kiro-governance/cert.pem via `openssl x509 -noout -fingerprint -sha256`

KIRO_GOV_MCP_URL=https://<your-ec2-elastic-ip>:443/mcp
KIRO_GOV_MCP_API_KEY=<your-api-key-from-ssm>
MCP_CERT_FINGERPRINT=<sha256-fingerprint>

# Optional: Project ID (if not derived from git remote)
KIRO_PROJECT_ID=<github-repo-name>
```

**Rules:**
- `.env.example` contains **ONLY** placeholders, no real secrets
- `.env.example` is committed to version control
- Real `.env` file is in `.gitignore`
- Add comment instructions for developers on where to get each value

> Source: F-02 §6.3 — ".env.example committed with placeholder values. .env added to .gitignore."

---

## 4. File: `.kiro/steering/orchestrator-standards.md` (MODIFY)

**Location:** Existing file  
**Status:** ADD NEW SECTION (does not modify existing sections)  
**Purpose:** Add human-approval gate logic and orchestrator hook pattern

### 4.1 New Section: "Governance Gates (MANDATORY)"

**Insert after "Core Rules" section and before "Delegation Protocol" section:**

```markdown
---

## Governance Gates (MANDATORY)

After each sub-agent completes a macro-gate artifact, you MUST invoke the human-approval gate:

### 4.1 The 10 Canonical Macro Gates

These gates require explicit human approval before proceeding:

| # | Gate | Phase | Sub-Agent | Typical Artifact |
|---|------|-------|-----------|------------------|
| 1 | Discovery outputs validated | Phase 1 | product-analyst | Meeting notes summary |
| 2 | Preliminary SRS validated | Phase 1 | product-analyst | Draft SRS (v0.1) |
| 3 | SRS approved | Phase 1 | product-analyst | Final SRS (v1.0) |
| 4 | Design docs approved | Phase 2 | aws-architect | Architecture doc + diagrams |
| 5 | Implementation plan approved | Phase 2 | plan-reviewer | Sprint backlog + timeline |
| 6 | Spec file approved | Phase 3 | executioner | Implementation spec (this file type) |
| 7 | Code approved | Phase 3 | code-reviewer | Pull request review |
| 8 | UAT report approved | Phase 3 | qa-agent | Test results + sign-off |
| 9 | Runbooks approved | Phase 4 | aws-architect | Operational runbooks |
| 10 | Project documentation approved | Phase 4 | aws-architect | Final project docs |

> **Source:** SRS §16 — Canonical macro gates. Gate names MUST match exactly (including capitalization).

### 4.2 Gate Invocation Protocol

When a sub-agent (above) completes an artifact for a macro gate:

**Step 1: Present to Human**

```
────────────────────────────────────────────
🏁 GOVERNANCE GATE: [GATE NAME]
────────────────────────────────────────────
Artifact: [path/to/artifact]
Produced by: [sub-agent name]
Gate Phase: [Phase number]

Summary:
[2-3 sentence description of what was produced]

────────────────────────────────────────────
Please review and respond:
  • "approve" — sign off this gate, record to governance DB + Slack
  • "reject [feedback]" — return to sub-agent for rework
────────────────────────────────────────────
```

**Step 2: Await Human Response**

- Wait for human to enter "approve" or "reject [feedback]"
- Do NOT timeout — Kiro CLI sessions remain open indefinitely

### 4.3 On Approval

When human enters "approve":

1. **Resolve project_id** (in priority order):
   - Check environment variable `KIRO_PROJECT_ID`
   - If not set: parse GitHub repo name from `git remote get-url origin`
   - If not available: read `.kiro/project.json` → `projectId` field
   - If all fail: inform human "Cannot determine project_id. Please set KIRO_PROJECT_ID environment variable." — **do not proceed**

2. **Resolve actor** (in priority order):
   - Read `git config user.name` from local git config
   - If empty: ask human "Who is approving this gate? (name or ID)"

3. **Call MCP Tool: `record_progress`**

   ```
   {
     project_id: <resolved-from-step-1>,
     update_text: "[GATE_NAME] approved by [actor]",
     type: "macro",
     gate: "[canonical gate name]",
     phase: "[Phase N]",
     source_ref: "[artifact-path]",
     actor: <resolved-from-step-2>,
   }
   ```

   Wait for response: `{ written: boolean, reason?: string }`

4. **Check Result:**
   - If `{ written: true }` → proceed to step 5
   - If `{ written: false, reason: 'duplicate' }` → log "Gate already recorded (likely by GitHub Actions). Proceeding." → skip step 5, proceed with workflow
   - If `{ written: false }` with other reason → log error and proceed (non-blocking)
   - If MCP call throws (connection error, timeout) → log "⚠️ Governance recording failed: [error]. Gate approval is valid. Proceeding." → proceed with workflow

5. **Call MCP Tool: `notify_slack`** (ONLY if step 4 returned `{ written: true }`)

   ```
   {
     project_id: <same-as-above>,
     message: "[GATE_NAME] approved by [actor] — artifact: [source_ref]",
     event_type: "macro",
   }
   ```

   Wait for response: `{ notified: boolean, reason?: string }`

   - If error or timeout: log warning and **continue** (Slack is best-effort, not blocking)

6. **Proceed with Workflow**

   After MCP calls complete (or fail), proceed to next phase/agent

### 4.4 On Rejection

When human enters "reject [feedback]":

1. Capture the feedback text (everything after "reject ")
2. **DO NOT call any MCP tools** — rejections are not governance events
3. Return artifact to the validating sub-agent with the feedback:
   ```
   Human rejected [GATE_NAME]. Feedback: [feedback-text]
   
   Please rework the artifact and re-submit for review.
   ```
4. The gate re-fires when the sub-agent resubmits (go back to §4.2 Step 1)

### 4.5 Example: "SRS approved" Gate

```
Orchestrator: Delegating SRS finalization to product-analyst...
[product-analyst produces final SRS at docs/srs.md]

Orchestrator presents:
────────────────────────────────────────────
🏁 GOVERNANCE GATE: SRS approved
────────────────────────────────────────────
Artifact: docs/srs.md
Produced by: product-analyst
Gate Phase: Phase 1

Summary:
The Software Requirements Specification has been completed and validated.
It includes all discovery outputs, acceptance criteria for 25 user stories,
and stakeholder sign-off.

────────────────────────────────────────────
Please review and respond:
  • "approve" — records to governance DB
  • "reject [feedback]" — returns to product-analyst
────────────────────────────────────────────
Human: "approve"

Orchestrator (internal):
  1. project_id = "kiro-governance" (from KIRO_PROJECT_ID env or git remote)
  2. actor = "alice" (from git config user.name)
  3. Call record_progress({
       project_id: "kiro-governance",
       update_text: "SRS approved by alice",
       type: "macro",
       gate: "SRS approved",
       phase: "Phase 1",
       source_ref: "docs/srs.md",
       actor: "alice"
     })
  → Returns: { written: true, pk: "project#kiro-governance", sk: "event#2026-06-11T23:28:07Z" }
  4. Call notify_slack({
       project_id: "kiro-governance",
       message: "SRS approved by alice — artifact: docs/srs.md",
       event_type: "macro"
     })
  → Returns: { notified: true }
  5. Proceed to Phase 2: Delegate to aws-architect for design

```

---

## 5. Sub-Agent Steering Files (7 FILES — MODIFY)

**Status:** ADD NEW SECTION to each steering file  
**Purpose:** Instrument micro-update logging (non-blocking governance progress tracking)

### 5.1 Why Micro Updates

Micro updates provide **sub-task visibility** without human gates or Slack notifications. They are best-effort — if an MCP call fails, the sub-agent continues working. This differs from macro gates, which are explicit approval points.

> Source: F-02 §4 — "Micro updates: best-effort, non-blocking"

### 5.2 11 Micro Events to Instrument

These events occur across sub-agents and should be logged via MCP. **Only** when a sub-agent completes a significant milestone:

| Event # | Event Text | Sub-Agent(s) | Trigger |
|---------|-----------|--------------|---------|
| 1 | "Domain decomposition done" | `aws-architect` | Architecture design complete |
| 2 | "Feature list defined" | `aws-architect` | Feature enumeration complete |
| 3 | "Data model draft complete" | `aws-architect` | Data model schema written |
| 4 | "Requirements gathering started" | `product-analyst` | Task delegation received |
| 5 | "Draft SRS sections written" | `product-analyst` | Intermediate SRS progress |
| 6 | "Architecture review started" | `plan-reviewer` | Review delegation received |
| 7 | "Review findings documented" | `plan-reviewer` | Review complete (before gate) |
| 8 | "Spec file generation started" | `executioner` | Spec task received |
| 9 | "Handler implementation complete" | `executioner` | Code written (before review) |
| 10 | "Test plan created" | `qa-agent` | QA task received |
| 11 | "Code review started" | `code-reviewer` | Review delegation received |

> Source: F-02 §4.5 — Exact event texts. Use these strings verbatim.

### 5.3 Micro Logging Template

**Add this section to EACH sub-agent steering file:**

```markdown
---

## Micro Update Logging (OPTIONAL - Best Effort)

When you begin or complete a significant sub-task, log a micro update via MCP.
This provides delivery leads with a timeline of progress.

### When to Log Micro Updates

DO log:
- Task started (e.g., "Requirements gathering started")
- Major intermediate milestone (e.g., "Domain decomposition done")
- Task completed but NOT a macro-gate artifact (e.g., "Review findings documented")

DO NOT log:
- Trivial actions (file reads, searches, API calls)
- Internal thinking or research
- Every sub-function call

### How to Call `record_progress`

```typescript
// Call the MCP tool with these parameters:
{
  project_id: "<resolved from KIRO_PROJECT_ID env or git remote>",
  update_text: "<exact event text from the table above>",
  type: "micro",
  source_ref: "<file path if applicable, or 'N/A'>",
  actor: "<your agent name, e.g. 'aws-architect'>",
  // omit: gate, phase, flag_override
}
```

### Micro Event Examples for [This Agent]

- Example 1: "Domain decomposition done" — when design is finalized
- Example 2: "Spec file generation started" — when you begin implementation spec

### Error Handling

If the MCP call fails (connection error, timeout, invalid response):
- Log a warning: "⚠️ Micro update logging failed. Continuing with work."
- **DO NOT STOP YOUR WORK** — micro updates are observability, not critical
- Continue with the next task

### No Human Gate, No Slack

- Micro updates do NOT require human approval
- Micro updates do NOT trigger Slack notifications
- They are audit trail only

---
```

### 5.4 Files to Modify (7 steering files)

Add the above "Micro Update Logging" section to each:

1. `.kiro/steering/product-analyst-standard.md`
   - Instruments events #4, #5: "Requirements gathering started", "Draft SRS sections written"

2. `.kiro/steering/aws-architect-standards.md`
   - Instruments events #1, #2, #3: "Domain decomposition done", "Feature list defined", "Data model draft complete"

3. `.kiro/steering/plan-reviewer-standards.md` (if exists; create if not)
   - Instruments events #6, #7: "Architecture review started", "Review findings documented"

4. `.kiro/steering/code-reviewer-standards.md` (if exists; create if not)
   - Instruments event #11: "Code review started"

5. `.kiro/steering/executioner-standards.md` (if exists; create if not)
   - Instruments events #8, #9: "Spec file generation started", "Handler implementation complete"

6. `.kiro/steering/qa-agent-standards.md` (if exists; create if not)
   - Instruments event #10: "Test plan created"

7. `.kiro/steering/backend-standards.md` or `.kiro/steering/developer-standards.md` (if exists)
   - Fallback for implementation agents (may instrument #8, #9)

> **Note:** If a steering file does not exist, create it with role definition + micro-logging section. Coordinate with orchestrator on agent structure.

---

## 6. Implementation Changes Summary

### 6.1 Files to Create

| File | Type | Size | Purpose |
|------|------|------|---------|
| `.kiro/mcp.json` | JSON config | ~150 lines | MCP server connection |
| `.env.example` | Bash template | ~15 lines | Env var reference |

### 6.2 Files to Modify

| File | Type | Change | Lines |
|------|------|--------|-------|
| `.kiro/steering/orchestrator-standards.md` | Markdown | Add "Governance Gates (MANDATORY)" section | ~200 |
| `.kiro/steering/product-analyst-standard.md` | Markdown | Add "Micro Update Logging" section | ~30 |
| `.kiro/steering/aws-architect-standards.md` | Markdown | Add "Micro Update Logging" section | ~30 |
| `.kiro/steering/plan-reviewer-standards.md` | Markdown | Add "Micro Update Logging" section (create if missing) | ~30 |
| `.kiro/steering/code-reviewer-standards.md` | Markdown | Add "Micro Update Logging" section (create if missing) | ~30 |
| `.kiro/steering/executioner-standards.md` | Markdown | Add "Micro Update Logging" section (create if missing) | ~30 |
| `.kiro/steering/qa-agent-standards.md` | Markdown | Add "Micro Update Logging" section (create if missing) | ~30 |

### 6.3 Files NOT Modified

- `.gitignore` — ensure `.env` is already ignored, `.kiro/mcp.json` is NOT ignored
- Individual agent prompts/tools — no changes (config via steering files only)
- Application code — this story is orchestration/config only

---

## 7. Acceptance Criteria (KG-06 AC from Backlog)

✓ `.kiro/steering/orchestrator.md` updated with governance gate instructions per F-02 §5.1  
✓ Gate logic covers all 10 canonical macro gates per F-02 §2.1 (SRS §16)  
✓ On human 'approve': orchestrator resolves project_id per F-02 §3.2  
✓ On human 'approve': orchestrator resolves actor per F-02 §3.3  
✓ On human 'reject': no MCP calls fire per F-02 §2.4  
✓ Gate presentation format shows artifact path, producer agent, gate name per F-02 §2.3  
✓ `.kiro/mcp.json` created with remote server config using env var interpolation per F-02 §6.2  
✓ `.env.example` committed with placeholder values per F-02 §6.3  
✓ All 10 macro gates listed in orchestrator-standards.md gate section  
✓ Delivery as branch + PR into app-dev agents repo per SRS FR-06 AC

---

## 8. Testing & Validation

### 8.1 Pre-Implementation Checks

- [ ] Verify `.kiro/mcp.json` syntax against Kiro MCP config schema
- [ ] Confirm `.env.example` is not in `.gitignore` (config template should be committed)
- [ ] Confirm `.env` is in `.gitignore` (secrets file should not be committed)
- [ ] Validate all 10 gate names match `packages/shared/constants/macro-gates.ts` exactly (case-sensitive)

### 8.2 Post-Implementation Validation

- [ ] Orchestrator can parse `project_id` from env, git remote, and `.kiro/project.json`
- [ ] Orchestrator can parse `actor` from git config and fallback to prompt
- [ ] MCP tool calls use correct parameter names and types per F-01 §3
- [ ] Micro-update logging can be triggered without blocking sub-agent work
- [ ] All 7 sub-agent steering files include micro-logging instructions
- [ ] Gate names in orchestrator guidance match SRS §16 exactly

### 8.3 Integration Testing (KG-13)

See KG-13 backlog story for end-to-end validation of the full Pathway 1 flow.

---

## 9. Delivery Checklist

**Delivery Strategy:** Single PR into app-dev agents repository (kiro/agents-app-dev)

### 9.1 Branch

```bash
git checkout -b feat/governance-gate-hooks
git pull origin main  # As per SRS FR-06 AC — must pull latest before changes
```

### 9.2 Commits

```bash
# Commit 1: New config files
git add .kiro/mcp.json .env.example
git commit -m "feat: Add MCP server connection config"

# Commit 2: Orchestrator guidance
git add .kiro/steering/orchestrator-standards.md
git commit -m "feat: Add human-approval gate instructions to orchestrator"

# Commit 3: Sub-agent micro-logging
git add .kiro/steering/*.md  # All updated steering files
git commit -m "feat: Add micro-update logging instructions to sub-agents"
```

### 9.3 PR Title & Description

**Title:** `feat: Add human-approval gate + orchestrator MCP hooks (KG-06)`

**Description:**

```
## Overview
Implements KG-06: Human-Approval Gate & Orchestrator Integration (F-02)

## Changes
- `.kiro/mcp.json`: MCP server connection config
- `.kiro/steering/orchestrator-standards.md`: Add governance gate logic for 10 canonical macro gates
- `.kiro/steering/{product-analyst,aws-architect,plan-reviewer,code-reviewer,executioner,qa-agent}.md`: 
  Add micro-update logging instructions (FR-07)
- `.env.example`: Add MCP env var placeholders

## Governance Gates Covered
1. Discovery outputs validated
2. Preliminary SRS validated
3. SRS approved
4. Design docs approved
5. Implementation plan approved
6. Spec file approved
7. Code approved
8. UAT report approved
9. Runbooks approved
10. Project documentation approved

## How It Works
- After each sub-agent completes a macro-gate artifact, orchestrator presents it to human for approval
- On approval: calls MCP tools `record_progress` + `notify_slack` to record event
- On rejection: artifact returns to sub-agent with feedback (no MCP calls)
- Micro updates logged throughout workflow for progress tracking (non-blocking)

## Tested
- Syntax validation of `.kiro/mcp.json`
- Environment variable resolution (project_id, actor)
- All 10 gate names match source constants

## Blocked By
- KG-04, KG-05: MCP server tools (`record_progress`, `notify_slack`)
- Pre-requisite: Latest kiro/agents-app-dev repo pulled

## Related
- F-02 Agent Integration Architecture
- FR-05 Orchestrator Hook — Macro Sign-Off Capture
- FR-06 Human-Approval Gate in Kiro Agents
- FR-07 Micro Update Logging (No Human Gate)
```

### 9.4 Merge Requirements

- [ ] All 10 macro gates listed correctly
- [ ] `.kiro/mcp.json` uses `${ENV_VAR}` syntax (never hardcoded values)
- [ ] `.env.example` committed, real `.env` in `.gitignore`
- [ ] All 7 sub-agent files updated with micro-logging section
- [ ] MCP tool call parameters match F-01 schema exactly
- [ ] Gate name strings match `packages/shared/constants/macro-gates.ts` (case-sensitive)

---

## 10. Dependencies & Blockers

### 10.1 Blocker: F-01 Implementation

This story depends on KG-04 and KG-05 being complete:
- `record_progress` MCP tool must exist (F-01 §3.2)
- `notify_slack` MCP tool must exist (F-01 §3.1)
- `packages/shared/constants/macro-gates.ts` must export the 10 canonical gates

### 10.2 Pre-Requisite: Kiro Agent Update

Must pull latest `kiro/agents-app-dev` repository before implementing:
```bash
git pull origin main
```

See SRS FR-06 AC — "Must pull latest Kiro agents before making changes"

---

## 11. Success Criteria

This spec is complete when:

✓ All 4 file changes (`.kiro/mcp.json`, `.env.example`, `orchestrator-standards.md`, 7 steering files) are implemented  
✓ All 10 canonical macro gates are listed in orchestrator guidance  
✓ MCP tool call patterns match F-01 §3 schemas exactly  
✓ Project_id and actor resolution logic is documented  
✓ Micro-logging instructions added to all relevant sub-agents  
✓ Branch + PR created and ready for review  

**Next Step:** KG-07 — Orchestrator Hook Implementation (calling `record_progress` + `notify_slack` on approval)

---

*End of KG-06 Implementation Spec v1.0*
