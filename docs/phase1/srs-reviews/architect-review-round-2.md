# Architect Review — SRS v1.1 (Round 2)

**Reviewer:** AWS Architect
**Date:** 2026-06-10
**SRS Version:** v1.1
**Verdict:** ⚠️ **CHANGES REQUIRED**

---

## Summary

All 8 findings from round 1 have been correctly addressed by the product analyst. The SRS is significantly improved — traceability is strong, ACs are testable, and architectural decisions are properly labeled. However, the round 1 fixes introduced **one new High-severity consistency issue** between FR-04, §11, and OQ-05 regarding whether the GitHub Actions workflow processes micro events. This must be resolved before approval.

---

## Round 1 Finding Verification

| Finding | Status | Notes |
|---------|--------|-------|
| FINDING-01: "Preliminary SRS validated" added to macro gates | ✅ Resolved | Present in FR-03 (item 2) and §16 as a separate row |
| FINDING-02: GitHub Actions workflow replaces UNVERIFIED GitHub Agent | ✅ Resolved | §11 now "Resolved Architectural Decisions"; FR-04 specifies GitHub Actions with architect decision label |
| FINDING-03: Idempotency key added to FR-09 | ✅ Resolved | PK + gate + day-granularity date clearly specified with architect decision label |
| FINDING-04: 10th macro gate "Project documentation approved" added | ✅ Resolved | FR-03 item 10 and §16 both include it as separate Phase 4 gate |
| FINDING-05: OQ-05 resolved (GitHub path = macro only) | ✅ Resolved | Moved to "Resolved Questions" with clear rationale citing brief §3 step 5 |
| FINDING-06: NFR-01 updated to p95 < 5s | ✅ Resolved | Concrete target with architect decision label and "POC-appropriate" qualifier |
| FINDING-07: flag_override AC clarified | ✅ Resolved | Rewritten to separate the boolean flag from the stored type value; audit marker semantics clear |
| FINDING-08: FR-08 dashboard filters labeled as architect decisions | ✅ Resolved | Filter capabilities now carry `Architect decision — not customer-specified` label |

---

## New Findings (Fresh Pass)

### FINDING-09 — Contradiction: Does the GitHub Actions Workflow Process Micro Events?

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Affected Sections** | FR-04 AC, §11 (Resolved Architectural Decisions — Scope), §12 (OQ-05 resolution) |
| **Description** | Three sections of the SRS give contradictory answers to: "Does the GitHub Actions workflow process micro events from `project-progress.md`?" |

**The contradiction:**

| Section | What it says | Interpretation |
|---------|--------------|----------------|
| FR-04 AC (step 3–4) | "For macro entries: call MCP server Slack tool AND DynamoDB tool. For micro entries: call MCP server DynamoDB tool only." | Workflow processes **both** macro and micro |
| §11 Scope paragraph | "The GitHub Actions workflow processes **macro events only** via the Slack + DB path. Micro events in `project-progress.md` are logged to DB by the workflow but do NOT trigger Slack notifications." | Self-contradictory — first sentence says "macro only," second sentence says micro events ARE logged by the workflow |
| OQ-05 Resolution (§12) | "Micro events are logged directly by sub-agents via the MCP server DynamoDB tool (FR-07), **not via the GitHub path.**" | Workflow processes **macro only**; micro events never touch the workflow |

**Source of truth (brief §3 step 5):** "if project-progress.md changed with **macro-gate lingo**, it verifies the gate was completed and runs the same two steps (Slack + DB)." This implies the GitHub path **only acts on macro-gate matches** — non-matching entries (micro) are ignored by the workflow entirely.

| **Required Fix** | Align all three sections to one consistent position. The brief supports: **the GitHub Actions workflow classifies entries and only calls MCP tools for macro entries. Micro entries in `project-progress.md` are ignored by the workflow** — they are logged to DB directly by sub-agents via FR-07. Specifically: (1) Remove FR-04 AC step 4 ("For micro entries: call MCP server DynamoDB tool only"). (2) Fix §11 Scope to remove the contradictory second sentence about micro events. (3) Ensure FR-04 and OQ-05 tell the same story. |

---

### FINDING-10 — §16 Gate Count vs Brief (Informational)

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Affected Section** | §16 (Canonical Macro Gates Reference), FR-03 |
| **Description** | The brief §4a has 9 rows in the macro gates table, with row 1 being "Discovery outputs / Preliminary SRS validated" (one combined entry with a slash). The SRS splits this into two separate rows ("Preliminary SRS validated" and "Discovery outputs validated"), making the total 10 gate entries. FR-03 describes this as "10 gates." This is functionally correct — both phrases should trigger macro classification — but the brief technically defines 9 gates, not 10. The slash in the brief indicates alternative lingo for the same gate, similar to "Design docs / solution architecture approved" which the SRS correctly keeps as one row with both variants. |
| **Required Fix** | None required (informational). The split is acceptable because both phrases need to be recognized as macro lingo for matching purposes. However, if consistency with the brief's structure is desired, rows 1 and 2 could be merged into a single gate row with both variants (matching how "Design docs / solution architecture approved" is handled), and FR-03 would say "9 gates" with multiple lingo variants per gate. This is a style choice, not a correctness issue. |

---

## Pre-Approval Checklist

| Check | Status |
|-------|--------|
| No internal agent names in document body | ✅ Pass — agent names appear only in §16 "Validating Sub-Agent" column (technical metadata, not prose) |
| No bare OQ codes without context | ✅ Pass |
| FR/NFR codes used appropriately | ✅ Pass |
| No internal file paths or review file names | ✅ Pass |
| No internal workflow terminology | ✅ Pass |
| Changelog authors are "Product Analyst" or "AWS Architect" only | ✅ Pass |
| Every FR has a Source tag | ✅ Pass |
| Field names match schema in §7 | ✅ Pass |
| Footer version matches changelog | ✅ Pass (v1.1) |

---

## Required Fixes Before Approval

| # | Finding | Action | Priority |
|---|---------|--------|----------|
| 1 | FINDING-09 | Resolve GitHub workflow micro-event contradiction across FR-04, §11, and OQ-05. All three must consistently state: workflow processes macro entries only; micro entries in `project-progress.md` are ignored by the workflow. | **Must fix** |

---

## Verdict

**⚠️ CHANGES REQUIRED**

One High-severity consistency issue (FINDING-09) must be resolved. Once FR-04 step 4 is removed and §11's Scope paragraph is corrected to align with OQ-05, the SRS is ready for approval.

All round 1 findings are confirmed resolved. No other Critical/High issues found.

---

*Review complete. Returning to orchestrator for product analyst action.*
