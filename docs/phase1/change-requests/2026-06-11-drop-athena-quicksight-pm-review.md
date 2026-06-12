# PM Review — Drop Athena & QuickSight Impact

**Date:** 2026-06-11
**Reviewer:** Technical PM
**Status:** APPROVED with recommendation

---

## Findings

### 1. Sprint 3 Viability (7 pts standalone)

**Viable as-is.** With 1 developer at 15–20 pts/sprint capacity, 7 pts is under-loaded (~40% utilization) but intentionally so. Sprint 3's purpose shifts from "build reporting" to "validate the whole system end-to-end." This is a natural integration/hardening sprint and benefits from slack to absorb Sprint 2 overflow or rework from code review findings.

Merging into Sprint 2 (16 → 23 pts) exceeds the 15–20 pt target capacity and introduces risk — KG-13 depends on KG-07 and KG-09, both Sprint 2 stories. Running KG-13 in the same sprint as its dependencies compresses the feedback loop to zero days, meaning any bug in Sprint 2 stories blocks the integration test within the same sprint.

### 2. Story Point Adjustment for KG-13

**No change needed (keep at 5 pts).** The scope reduction (remove Athena/QuickSight query validation ACs) is offset by the added complexity of testing through Kiro CLI agent workflow rather than a standalone harness. The net effort is roughly equivalent:

| Removed | Added |
|---------|-------|
| Athena query validation AC | Kiro CLI orchestrator trigger setup |
| QuickSight data verification | Agent workflow end-to-end validation |

5 pts remains appropriate for a Medium-complexity integration test with multiple pathways (macro, micro, dedup, GitHub Actions, classification).

### 3. Dependency Chain Impact

**No breaks.** KG-10/11/12 had no downstream dependents — they were terminal stories in the dependency graph:

```
KG-01 → KG-10 → KG-11 → KG-12  (dropped — no other story depends on these)
KG-07 + KG-09 → KG-13           (intact)
KG-02 + KG-03 → KG-14           (intact)
```

KG-13 and KG-14 dependencies remain satisfied by Sprint 1 and Sprint 2 stories. No reordering required.

### 4. Sprint Recommendation

**Keep 3 sprints.** Rationale:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Keep 3 sprints (7 pts in S3) | Buffer for rework; clean validation phase; no capacity risk | Slightly under-loaded sprint | ✅ **Recommended** |
| Collapse to 2 sprints (merge into S2) | Faster calendar delivery | Sprint 2 at 23 pts exceeds capacity; KG-13 runs same sprint as its deps; no buffer | ❌ Rejected |

---

## Revised Sprint Summary

| Sprint | Stories | Points | Focus |
|--------|---------|--------|-------|
| Sprint 1 | KG-01 – KG-05 | 18 | Infrastructure + MCP Server Core |
| Sprint 2 | KG-06 – KG-09 | 16 | Agent Integration + GitHub Trigger |
| Sprint 3 | KG-13 + KG-14 | 7 | End-to-end validation + Runbooks |
| **Total** | **9 stories** | **41 pts** | **3 weeks** |

**Delta from original:** −7 pts, −5 stories (KG-10/11/12 dropped + E5 epic row removed).

---

## Action Items for Backlog Update

- [ ] Remove KG-10, KG-11, KG-12 rows from `jira-backlog.csv`
- [ ] Remove E5 (Reporting) epic row from `jira-backlog.csv`
- [ ] Update KG-13 AC — remove Athena/QuickSight validation, add Kiro CLI workflow trigger
- [ ] Update KG-14 AC — remove QuickSight runbook content
- [ ] Update KG-01 AC — remove S3 Athena buckets, Athena connector role, QuickSight role, Athena workgroup
- [ ] Update implementation-strategy.md §3, §5, §9 to reflect revised sprint totals and cost

---

*End of PM Review*
