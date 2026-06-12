# KG-08: Micro Update Logging — Code Review

**Story:** KG-08 — Instrument all 11 micro events across sub-agents  
**Author:** Backend Developer (spec-impl-kg08)  
**Date:** 2026-06-11  
**Status:** Implementation Review  

---

## Executive Summary

KG-08 adds a **Micro Logging** section to each sub-agent steering file, instructing agents to call `record_progress` MCP tool with `type: "micro"` at their appropriate lifecycle events. This implements FR-07 (Micro Update Logging) from F-02 architecture.

**Deliverable:** 4 steering files updated with consistent micro-logging instructions.

---

## Specification

### 1. Mapping: Micro Events → Steering Files

From F-02 §4.5, the 11 micro events map to these steering files:

| Micro Event | Agent | Steering File | Event # |
|-------------|-------|---------------|---------|
| "Domain decomposition done" | aws-architect | `aws-architect-standards.md` | 1 |
| "Feature list defined" | aws-architect | `aws-architect-standards.md` | 2 |
| "Data model draft complete" | aws-architect | `aws-architect-standards.md` | 3 |
| "Requirements gathering started" | product-analyst | `product-analyst-standard.md` | 4 |
| "Draft SRS sections written" | product-analyst | `product-analyst-standard.md` | 5 |
| "Architecture review started" | plan-reviewer | `reviewer-standards.md` | 6 |
| "Review findings documented" | plan-reviewer | `reviewer-standards.md` | 7 |
| "Spec file generation started" | executioner/backend | `backend-standards.md` | 8 |
| "Handler implementation complete" | executioner/backend | `backend-standards.md` | 9 |
| "Test plan created" | qa-agent | (No steering file — N/A for this sprint) | 10 |
| "Code review started" | code-reviewer | (No steering file — N/A for this sprint) | 11 |

**Note:** `qa-agent` and `code-reviewer` steering files do not exist in `.kiro/steering/`. Per instructions, we only modify files that exist. Events 10–11 are documented here but implementation is deferred.

---

### 2. Micro Logging Section Template

Each steering file receives a standardized **## Micro Logging** section appended at the end:

```markdown
## Micro Logging (MANDATORY)

When you complete a [specific event], call the `record_progress` MCP tool with:

- **project_id**: Resolved from:
  1. Environment variable `KIRO_PROJECT_ID` (if set)
  2. Git remote: `git remote get-url origin | extract-repo-name`
  3. Fallback: Ask the user

- **update_text**: "[exact event text from F-02 §4.5]"

- **type**: `"micro"`

- **source_ref**: 
  - If a file was created/modified: relative path from repo root (e.g., `docs/srs.md`)
  - If no artifact: `"N/A"`

- **actor**: "[agent name, e.g., 'aws-architect']"

### MCP Call Rules

- Call is **non-blocking** — do not wait for response before continuing work
- If the MCP call fails (connection error, timeout), **log a warning and continue** — do not block your workflow
- Micro updates trigger NO human gate, NO Slack notification, NO deduplication check
- Always use exact event text from the table above

### When to Log

Log a micro update when you:
1. **Begin** a delegated task
2. **Complete** an intermediate milestone
3. **Finish** the task (if output is not a macro-gate artifact)
```

### 3. Event-Specific Instructions

#### **aws-architect-standards.md** — 3 Events

Add to end of file:

```markdown
## Micro Logging (MANDATORY)

The aws-architect logs three micro updates as documented in F-02 §4.5:

| Event | When to Log | source_ref |
|-------|-----------|-----------|
| "Domain decomposition done" | After domain boundaries are defined | `docs/domain-decomposition.md` or artifact path |
| "Feature list defined" | After feature inventory is complete | `docs/feature-list.md` or artifact path |
| "Data model draft complete" | After database schema is drafted | `docs/data-model.md` or artifact path |

### How to Call record_progress

On completing each event, invoke the MCP tool:

```typescript
// Example for "Domain decomposition done"
{
  project_id: "<resolved from KIRO_PROJECT_ID or git remote>",
  update_text: "Domain decomposition done",
  type: "micro",
  source_ref: "<path to decomposition artifact or 'N/A'>",
  actor: "aws-architect"
}
```

**Rules:**
- Call is non-blocking — do NOT wait for MCP response
- If MCP call fails, log warning and continue your work
- Never hardcode project_id — always resolve at runtime
```

#### **product-analyst-standard.md** — 2 Events

Add to end of file:

```markdown
## Micro Logging (MANDATORY)

The product-analyst logs two micro updates as documented in F-02 §4.5:

| Event | When to Log | source_ref |
|-------|-----------|-----------|
| "Requirements gathering started" | When you begin stakeholder interviews and discovery | `"N/A"` (no artifact yet) |
| "Draft SRS sections written" | After drafting SRS content (before formal review) | `docs/srs.md` or artifact path |

### How to Call record_progress

On completing each event, invoke the MCP tool:

```typescript
// Example for "Requirements gathering started"
{
  project_id: "<resolved from KIRO_PROJECT_ID or git remote>",
  update_text: "Requirements gathering started",
  type: "micro",
  source_ref: "N/A",
  actor: "product-analyst"
}
```

**Rules:**
- Call is non-blocking — do NOT wait for MCP response
- If MCP call fails, log warning and continue your work
- Never hardcode project_id — always resolve at runtime
```

#### **reviewer-standards.md** — 2 Events

Add to end of file:

```markdown
## Micro Logging (MANDATORY)

The plan-reviewer logs two micro updates as documented in F-02 §4.5:

| Event | When to Log | source_ref |
|-------|-----------|-----------|
| "Architecture review started" | When you receive a spec for review | `<path to spec being reviewed>` |
| "Review findings documented" | After you complete the review and document findings | `<path to review findings or spec>` |

### How to Call record_progress

On completing each event, invoke the MCP tool:

```typescript
// Example for "Architecture review started"
{
  project_id: "<resolved from KIRO_PROJECT_ID or git remote>",
  update_text: "Architecture review started",
  type: "micro",
  source_ref: "<path to spec artifact>",
  actor: "plan-reviewer"
}
```

**Rules:**
- Call is non-blocking — do NOT wait for MCP response
- If MCP call fails, log warning and continue your work
- Never hardcode project_id — always resolve at runtime
```

#### **backend-standards.md** — 2 Events

Add to end of file:

```markdown
## Micro Logging (MANDATORY)

The executioner (backend implementer) logs two micro updates as documented in F-02 §4.5:

| Event | When to Log | source_ref |
|-------|-----------|-----------|
| "Spec file generation started" | When you begin generating/writing spec files (OpenAPI, types) | `specs/api/<domain>.yaml` or artifact path |
| "Handler implementation complete" | After you finish writing handler code (before code review) | `packages/<domain>/handlers/<handler>.ts` or artifact path |

### How to Call record_progress

On completing each event, invoke the MCP tool:

```typescript
// Example for "Spec file generation started"
{
  project_id: "<resolved from KIRO_PROJECT_ID or git remote>",
  update_text: "Spec file generation started",
  type: "micro",
  source_ref: "<path to spec file>",
  actor: "executioner"
}
```

**Rules:**
- Call is non-blocking — do NOT wait for MCP response
- If MCP call fails, log warning and continue your work
- Never hardcode project_id — always resolve at runtime
```

---

## Implementation Checklist

- [x] F-02 §4.5 micro events table read and verified (11 events)
- [x] Mapped events to steering files (4 files need updates)
- [x] Confirmed which steering files exist: `aws-architect-standards.md`, `product-analyst-standard.md`, `reviewer-standards.md`, `backend-standards.md`
- [x] Reviewed F-01 §3.2 `record_progress` input schema (field names, types)
- [x] Defined project_id resolution logic (env → git remote → config)
- [x] Defined actor values (agent name strings)
- [x] Confirmed non-blocking behavior (no wait for response)
- [x] Confirmed no human gate (micro events are ungated)
- [x] Confirmed no Slack notification (micro → `{ notified: false }`)
- [x] Confirmed source_ref handling (file path or "N/A")
- [x] Created standardized MCP call template per steering file
- [x] Deferred: qa-agent and code-reviewer steering files do not exist

---

## Architecture Alignment

This implementation aligns with:

1. **F-02 §4 (Micro Update Logging)** — Exact micro events and flow
2. **F-01 §3.2 (record_progress tool)** — Input schema and field names
3. **F-01 §3.1 (notify_slack tool)** — Output behavior for micro events (no notification)
4. **Code Structure doc §5** — Steering file location and pattern
5. **Agent Integration Architecture §4.5** — The 11 micro events table

---

## Key Decisions

1. **Non-blocking calls**: If MCP call fails, agents log warning and continue. This allows the workflow to proceed even if the governance recording system is temporarily unreachable (redundancy via GitHub Actions path F-03).

2. **project_id resolution**: Three-tier fallback (env → git remote → config) provides robustness without requiring hardcoded values.

3. **Deferred events**: Events 10–11 (qa-agent, code-reviewer) are documented in this review but implementation is deferred because those steering files do not currently exist. They can be added in a future sprint when those agent steering files are created.

4. **Consistent template**: All 4 updated steering files use the same section structure and rules, ensuring agents have identical expectations.

---

## Testing Notes

### Manual Verification (E2E)

1. Set `KIRO_PROJECT_ID=test-project` in agent environment
2. Run agent workflow that triggers a micro event (e.g., aws-architect completes domain decomposition)
3. Verify MCP call is attempted (check logs)
4. Verify DynamoDB record created with:
   - `type: "micro"`
   - Correct `update_text`
   - `actor: "aws-architect"`
   - `source_ref` populated
5. Verify workflow continues even if MCP call fails (kill MCP server, verify agent continues)

### Unit Tests (in MCP server)

Already covered by F-01 (`packages/mcp-server/__tests__/`):
- `record_progress` tool with `type: "micro"` input
- No dedup sentinel for micro events
- No Slack notification triggered

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Agent doesn't call MCP (forgets to implement) | Medium | Steering file makes it MANDATORY with clear examples. Code review will verify. |
| Hardcoded project_id in agent prompt | Medium | Instructions emphasize "always resolve at runtime" and document fallback chain. |
| MCP server unreachable blocks workflow | Low | Instructions state calls are non-blocking; agent logs warning and continues. |
| Wrong update_text used (typo/drift) | Low | Steering file includes exact text from F-02 table; agents copy-paste from section. |

---

## Deliverables Summary

| File | Change | Lines Added |
|------|--------|------------|
| `aws-architect-standards.md` | Append Micro Logging section with 3 events | ~30 |
| `product-analyst-standard.md` | Append Micro Logging section with 2 events | ~25 |
| `reviewer-standards.md` | Append Micro Logging section with 2 events | ~25 |
| `backend-standards.md` | Append Micro Logging section with 2 events | ~25 |
| Total | — | ~105 |

---

## Sign-Off

✅ **Specification Complete**  
✅ **Alignment Verified** (F-02, F-01, Code Structure)  
✅ **Implementation Strategy Clear**  

**Next Steps:**
1. Add micro logging sections to 4 steering files (this document)
2. Update orchestrator-standards.md reference (already done in KG-06/07)
3. Test agent MCP calls end-to-end (KG-13)

---

*End of KG-08 Code Review*
