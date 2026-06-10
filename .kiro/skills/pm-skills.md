# Technical Project Manager Skills

## 1. Kanban Board Management

### Board Structure

- 5-column Kanban: Backlog → Spec Ready → In Progress → Review → Done
- "Spec Ready" is the quality gate — no story enters development with open architecture gaps
- WIP limits enforced per column (configurable per team size)

### Story Lifecycle

1. **Backlog**: Story created from architecture doc. May have open gaps.
2. **Spec Ready**: All gaps resolved. Architecture doc complete. Acceptance criteria testable. Data model committed.
3. **In Progress**: Developer (or Kiro) actively building. Daily standup visibility.
4. **Review**: Code review + architecture review (does implementation match spec?).
5. **Done**: Merged, tested, acceptance criteria verified.

---

## 2. Estimation Framework

### Traditional Development

- Use Fibonacci story points (1, 2, 3, 5, 8, 13)
- Tasks estimated in hours
- Include: coding, unit tests, integration tests, code review, documentation
- Buffer: +20% for unknowns on first sprint, +10% thereafter

### Spec-Based Development (Kiro)

- Same point scale but adjusted for AI-assisted generation
- 40-60% effort reduction for well-specified features
- New task types: spec review, output validation, prompt refinement
- Higher reduction on CRUD/boilerplate, lower reduction on complex business logic
- **Spec readiness is the bottleneck, not coding** — invest time in architecture docs

### Velocity Tracking

- Track velocity separately for traditional vs Kiro-assisted stories
- First 2 sprints: use estimated velocity (team size × 6-8 pts/dev/sprint)
- Sprint 3+: use actual measured velocity
- Kiro velocity typically 1.5-2x traditional velocity for same team

---

## 3. Dependency Management

### Rules

- Every story must declare its dependencies (blocked-by)
- Critical path = longest chain of dependent stories
- Parallelize independent stories across developers
- Foundation layer (auth, DB, RLS) must complete before feature layer
- Cross-module stories (consent + referral, [integration-provider] + agency) need explicit sequencing

### Dependency Sources

- `technical-architecture.md` Feature Architecture Status table
- Implementation order (Layer 1 → Layer 5 from architect's recommendation)
- Data model FK relationships (table A references table B → B first)
- API contract dependencies (endpoint X calls endpoint Y → Y first)

---

## 4. Risk Management

### Blockers to Track

- Open stakeholder questions (from architecture doc open questions)
- Unresolved edge case gaps (from edge-case-gap-tracker.md)
- Missing customer deliverables (field lists, threshold values, format confirmations)
- External dependencies ([integration-provider] API access, SMS provider setup, Cognito configuration)

### Escalation Path

- Open gap blocking a story → escalate to AWS Architect for resolution
- Stakeholder question blocking a story → escalate to Product Owner
- Technical blocker during implementation → escalate to Tech Lead
- Scope creep detected → escalate to Product Owner for change control

---

## 5. Sprint Planning

### Pre-Sprint Checklist

- [ ] All stories in sprint have "Spec Ready" status
- [ ] No open gaps in edge-case-gap-tracker.md for sprint stories
- [ ] Dependencies between sprint stories are sequenced correctly
- [ ] Team capacity calculated (available hours minus meetings/PTO)
- [ ] Sprint goal defined (which epics/features advance?)

### Sprint Ceremonies (Kanban-adapted)

- **Daily standup**: 15 min, focus on blockers and WIP
- **Weekly replenishment**: Move stories from Backlog → Spec Ready as gaps are resolved
- **Bi-weekly review**: Demo completed stories to stakeholders
- **Retrospective**: After each feature epic completes

---

## 6. Reporting

### Metrics to Track

| Metric                         | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| Cycle time (Spec Ready → Done) | How long stories take to complete               |
| Lead time (Backlog → Done)     | Total time including spec preparation           |
| WIP count                      | Stories in progress simultaneously              |
| Blocked count                  | Stories waiting on gaps/questions               |
| Spec readiness rate            | % of backlog stories that are Spec Ready        |
| Kiro vs traditional velocity   | Compare AI-assisted vs manual development speed |
| Gap resolution rate            | How fast edge case gaps are being closed        |

---

## 7. Document Awareness

### Must Read Before Planning

- All feature architecture docs in `docs/`
- `docs/edge-case-gap-tracker.md` — the source of truth for spec readiness
- `docs/technical-architecture.md` — feature status and implementation order
- `srs.md` — requirements and priorities
- `docs/data-model.md` — schema dependencies
- `docs/vciso-risk-delta-analysis.md` — security tasks to weave in

### Must Update After Planning

- Sprint board markdown file
- edge-case-gap-tracker.md (if gaps are resolved during planning)
- technical-architecture.md (if implementation order changes)

---

## JIRA-Importable CSV Format (MANDATORY)

The backlog CSV must follow this exact format for JIRA import compatibility:

### Column Definitions

| Column          | Required       | Description                                                  |
| --------------- | -------------- | ------------------------------------------------------------ |
| `Issue Type`    | ✅             | `Epic`, `Story`, or `Sub-task`                               |
| `Summary`       | ✅             | Short title (e.g., "Implement client search API")            |
| `Description`   | ✅ for Stories | Detailed description with context                            |
| `Priority`      | ✅             | `Highest`, `High`, `Medium`, `Low`, `Lowest`                 |
| `Story Points`  | Stories only   | Fibonacci: 1, 2, 3, 5, 8, 13                                 |
| `Sprint`        | ✅ for Stories | Sprint assignment (e.g., "Sprint 1", "Sprint 2")             |
| `Labels`        | ✅             | Feature area label (e.g., "auth", "referrals", "[integration-provider]")     |
| `Component`     | ✅             | Domain/module (e.g., "Auth", "Clients", "Referrals")         |
| `Assignee Role` | ✅             | `Backend`, `Frontend`, `Fullstack`, `DevOps`                 |
| `Blocked By`    | If applicable  | Summary of blocking story (e.g., "S0.1: CDK Bootstrap")      |
| `SRS Reference` | ✅             | FR traceability (e.g., "FR-AUTH-001", "SRS §6.1")            |
| `Spec Strategy` | ✅             | Architecture doc reference (e.g., "auth-architecture.md §3") |

### Rules

- Epics have no Story Points or Sprint
- Every Story must have an SRS Reference — no story exists without a traceable FR
- Every Story must have a Spec Strategy — developer must know which architecture doc to read
- Blocked By references must point to real stories in the CSV
- Acceptance criteria go in the Description field as a bullet list
- CSV must be UTF-8 with quoted fields (handles commas in descriptions)

### Example Rows

```csv
"Issue Type","Summary","Description","Priority","Story Points","Sprint","Labels","Component","Assignee Role","Blocked By","SRS Reference","Spec Strategy"
"Epic","E1: Authentication & Authorization","","Highest","","","auth","Auth","Backend","","SRS §6.1-6.2",""
"Story","S1.1: Cognito user pool setup","AC:\n- Staff pool with email login\n- Client pool with phone login\n- JWT includes county_id and role claims","High","3","Sprint 1","auth","Auth","Backend","S0.1: CDK Bootstrap","FR-AUTH-001","auth-architecture.md §2"
```
