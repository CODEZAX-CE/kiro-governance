# KG-07: Orchestrator Hook — Macro Sign-Off MCP Call

**Story ID:** KG-07  
**Feature:** F-02 — Human-Approval Gate & Orchestrator Hook  
**Phase:** Sprint 2  
**Specification Date:** 2026-06-11  

---

## 1. Overview

**Task:** Verify and finalize the **orchestrator hook call sequence** — the exact steps the orchestrator takes AFTER a human types "APPROVE" at a macro gate.

**Scope:** This spec covers the orchestrator's behavior in `.kiro/steering/orchestrator-standards.md` when handling human approval of a macro gate. It does NOT cover the sub-agent micro logging (FR-07) or the MCP tool implementations (F-01) — those are out of scope for KG-07.

**Deliverable:** Updated `orchestrator-standards.md` with verified, complete orchestrator hook call sequence.

---

## 2. Specification Strategy

**Source Documents:**
- `docs/code-structure.md` — project structure context
- `docs/phase1/agent-integration-architecture.md` § 2–3 — human-approval gate and orchestrator hook requirements
- `.kiro/steering/orchestrator-standards.md` — current orchestrator standards (added in KG-06)

**Approach:** 
1. Read the current orchestrator-standards.md "On Approval" section
2. Verify it matches F-02 §3.1 requirements exactly
3. Verify `record_progress` call parameters are correct per F-02 §3.1
4. Verify response handling and conditional `notify_slack` call logic
5. If all match: verify and mark complete without changes
6. If gaps exist: update orchestrator-standards.md with corrections

---

## 3. Acceptance Criteria

### AC-1: Orchestrator Hook Call Sequence Documented
- ✅ Step 1: Resolve `project_id` (3-tier: env → git remote → .kiro/project.json)
- ✅ Step 2: Resolve `actor` (git config user.name → ask human)
- ✅ Step 3: Call `record_progress` MCP tool with all required fields
- ✅ Step 4: Check response (if `{ written: true }` → proceed; if duplicate/error → handle)
- ✅ Step 5: Call `notify_slack` ONLY if step 4 returned `{ written: true }`
- ✅ Step 6: Proceed with workflow

**Where:** `.kiro/steering/orchestrator-standards.md` section "On Approval"

### AC-2: `record_progress` Call Parameters Are Correct
Per F-02 §3.1, the MCP call must include:
- ✅ `project_id`: resolved project id
- ✅ `update_text`: "[gate name] approved by [actor]"
- ✅ `type`: "macro"
- ✅ `gate`: canonical gate name from SRS §16
- ✅ `phase`: phase number (e.g. "Phase 1")
- ✅ `actor`: resolved actor
- ✅ `source_ref`: path to the approved artifact

**Where:** `.kiro/steering/orchestrator-standards.md` MCP call details

### AC-3: Response Handling Is Correct
- ✅ If `{ written: true }` → proceed to `notify_slack`
- ✅ If `{ written: false, reason: 'duplicate' }` → log and skip `notify_slack`
- ✅ If error or timeout → log warning, proceed (non-blocking)

**Where:** `.kiro/steering/orchestrator-standards.md` error handling section

### AC-4: Conditional `notify_slack` Call
- ✅ Only called if `record_progress` returned `{ written: true }`
- ✅ Includes: `project_id`, `message`, `event_type: 'macro'`
- ✅ Failure does not block workflow (best-effort)

**Where:** `.kiro/steering/orchestrator-standards.md` notify_slack section

### AC-5: Spec Matches F-02 §3.1-3.5 Exactly
- ✅ All parameter names match F-02 schema
- ✅ All error handling scenarios covered
- ✅ All non-blocking semantics preserved

**Where:** `.kiro/steering/orchestrator-standards.md`

---

## 4. Implementation Details

### 4.1 Orchestrator Hook Entry Point

When human inputs "approve" at a governance gate, the orchestrator immediately:

```
1. Resolve project_id
   - Check env: KIRO_PROJECT_ID
   - If not set: parse from `git remote get-url origin` (extract repo name)
   - If not available: read .kiro/project.json → projectId field
   - If all fail: inform human and block

2. Resolve actor
   - Read `git config user.name`
   - If empty: ask human "Who is approving this gate? (name or ID)"

3. Call MCP tool: record_progress
   Parameters:
   {
     project_id: <resolved>,
     update_text: "<gate name> approved by <actor>",
     type: "macro",
     gate: "<canonical gate name>",
     phase: "<phase number, e.g. 'Phase 1'>",
     source_ref: "<artifact path>",
     actor: <resolved>,
   }

4. Handle response
   - If { written: true } → proceed to step 5
   - If { written: false, reason: 'duplicate' } → log info, skip step 5, proceed to step 6
   - If error or timeout → log warning, proceed to step 6

5. Call MCP tool: notify_slack (ONLY if step 4 returned written: true)
   Parameters:
   {
     project_id: <same as above>,
     message: "<gate name> approved by <actor> — artifact: <source_ref>",
     event_type: "macro"
   }
   
   - If error or timeout: log warning (non-blocking, continue)

6. Proceed with workflow
```

### 4.2 Canonical Gate Name Mapping

The orchestrator must use canonical gate names from the 10 gates defined in SRS §16:

```
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
```

Phase assignments (per SRS §16):
```
Phase 1: Gates 1-3
Phase 2: Gates 4-5
Phase 3: Gates 6-8
Phase 4: Gates 9-10
```

### 4.3 Error Scenarios

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| MCP server unreachable | Log error; inform human "⚠️ Governance recording failed. Gate approval is still valid." Proceed with workflow. | Non-blocking per F-02 §3.5; GitHub Actions path provides redundancy |
| `project_id` cannot be resolved | Inform human "Cannot determine project_id. Please set KIRO_PROJECT_ID." Block workflow. | Cannot proceed without identity |
| `actor` unavailable (no git config, no user response) | Ask human. If no response, use "unknown". | Allow gate to proceed with best-effort identity capture |
| Duplicate event (`written: false, reason: 'duplicate'`) | Log "Gate already recorded (likely by GitHub Actions path)." Skip `notify_slack`. Proceed. | Dedup prevents duplicate Slack notifications per F-01 §5.4 |
| `notify_slack` fails | Log warning. Do NOT block workflow. | Slack notifications are best-effort per SRS NFR-02 |

---

## 5. Current State Verification

**Reviewed:** `.kiro/steering/orchestrator-standards.md` sections:
- Section 2: Governance Gates Overview ✅
- Section 2.1–2.6: Gate Presentation & Approval Flow ✅
- Section 3: Orchestrator Hook — Macro Sign-Off ✅
- Section 3.1–3.5: Call sequences and error handling ✅

**Finding:** The orchestrator-standards.md produced in KG-06 **already contains the complete orchestrator hook call sequence** matching F-02 §3.1 exactly:

✅ Step 1: Resolve project_id (3-tier: env → git remote → .kiro/project.json)
✅ Step 2: Resolve actor (git config user.name → ask human)
✅ Step 3: Call record_progress MCP tool with all required fields
✅ Step 4: Check response (written: true/false/error handling)
✅ Step 5: Call notify_slack ONLY if step 4 returned written: true
✅ Step 6: Proceed with workflow

**Parameters verification:**
- ✅ `project_id`: resolved from 3-tier resolution
- ✅ `update_text`: "[gate name] approved by [actor]"
- ✅ `type`: "macro"
- ✅ `gate`: canonical gate name from SRS §16
- ✅ `phase`: phase number (e.g. "Phase 1")
- ✅ `actor`: resolved actor
- ✅ `source_ref`: path to the approved artifact

**Error handling verification:**
- ✅ Duplicate detection: skip notify_slack
- ✅ MCP failure: non-blocking, proceed with workflow
- ✅ project_id unresolvable: block with clear error message
- ✅ actor unavailable: ask human or use "unknown"

**Conclusion:** KG-07 verification is **COMPLETE WITHOUT CHANGES**. The orchestrator-standards.md produced in KG-06 satisfies all KG-07 requirements.

---

## 6. Verification Checklist

- [x] Orchestrator hook call sequence documented (steps 1-6)
- [x] project_id resolution: env → git remote → .kiro/project.json
- [x] actor resolution: git config user.name → ask human
- [x] record_progress call parameters correct (all 7 fields)
- [x] Response handling: written=true → proceed; written=false duplicate → skip notify_slack; error → non-blocking
- [x] Conditional notify_slack call (only if written: true)
- [x] Error scenarios: MCP failure, missing project_id, missing actor, duplicate events
- [x] All parameter names match F-02 §3.1 schema
- [x] All gate names match SRS §16 canonical gates
- [x] Phase assignments per SRS §16
- [x] Non-blocking semantics preserved throughout

---

## 7. Definition of Done

- [x] Specification verified against F-02 §3.1-3.5
- [x] Orchestrator hook call sequence complete and correct
- [x] All MCP call parameters correct
- [x] Error handling scenarios documented
- [x] Canonical gate names and phase assignments verified
- [x] Spec matches architecture docs exactly
- [x] No ambiguities or gaps

**Status: READY FOR CODE REVIEW** ✅

---

## 8. References

| Document | Section | Purpose |
|----------|---------|---------|
| `docs/phase1/agent-integration-architecture.md` | § 2.1 | Canonical macro gates |
| `docs/phase1/agent-integration-architecture.md` | § 3.1 | MCP tool call parameters |
| `docs/phase1/agent-integration-architecture.md` | § 3.2-3.5 | project_id, actor, source_ref, error handling |
| `docs/phase1/mcp-server-core-architecture.md` | § 3.1-3.2 | MCP tool schemas and responses |
| `.kiro/steering/orchestrator-standards.md` | § 4 | On Approval gate logic |
| SRS | § 16 | Canonical macro gates list |
| SRS | § FR-05 | Orchestrator Hook — Macro Sign-Off Capture |

---

**Specification Status: VERIFIED — No Changes Required**  
**Ready for Implementation: YES**  
**Implementation Path: None (already complete in KG-06)**
