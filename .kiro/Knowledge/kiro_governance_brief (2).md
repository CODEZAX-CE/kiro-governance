# Project Brief — `kiro_governance`

**Type:** Proof of Concept (POC)
**Theme:** Governance & oversight for agentic (AI-agent-driven) delivery
**Priority for this POC:** Pathway 1 (agent-generated artifacts) + Slack notification via MCP server

---

## 1. Why we're doing this (the problem)

As we move delivery work onto agentic tooling (Kiro sub-agents generating architecture docs, specs, and code), the output is being produced faster than it can be governed. Today there is no consistent, automated way to:

- check that an agent-generated artifact meets our standards before it moves forward,
- apply both an automated check **and** a human sign-off,
- keep a record of what was checked, when, and with what result, and
- give the project team live visibility into where each deliverable sits in the pipeline.

`kiro_governance` is a POC that puts a lightweight **governance gate and notification layer** around Kiro's output, so AI-accelerated delivery stays auditable and under human control.

**Where this fits:** this capability is the *Governance & Reporting* lane of the broader **Agentic Service Delivery Methodology** (Phases 0–4: Internal Prep → Discover & Align → Design & Review → Build & Implement → Launch & Enable). Across those phases the same macro-gate pattern repeats at every quality gate:

> **Human review → Commit to Git → Orchestrator calls MCP Server → GitHub Agent updates the Project Tracker DB → Slack notification.**

This POC builds the reusable machinery (MCP server + DB + GitHub agent + the human-approval gate in the agents) that every gate in the methodology will call. Named sub-agents already in the methodology include `orchestrator`, `product-analyst`, `aws-architect`, `technical-pm`, `security-reviewer`, `plan-reviewer`, `code-reviewer`, `qa-agent`, and `executioner`.

## 2. What we're building (objective)

A governance pipeline that triggers automatically when a Kiro sub-agent produces an artifact, runs it through validation and gating (automated + human), stores the result, and notifies the relevant project's Slack channel. The POC proves the end-to-end loop on **one pathway** before we generalise.

## 3. How it works

The flow has two pathways. **Pathway 1 is the scope of this POC. Pathway 2 is deferred and not required for now** — it is documented below only so the design doesn't preclude it later.

### Pathway 1 — Agent-generated artifacts *(primary)*

1. **Kiro sub-agent generates an artifact** (e.g., an architecture document or SRS). Sub-agents in Kiro run with their own isolated context and are delegated by the main agent.
2. **Explicit human-approval gate** — for a macro item, a human reviews and approves the artifact. *This gate does not exist in the agents yet and must be added; the hook fires off it.*
3. **On approval, the `orchestrator` hook calls the MCP server tool.**
4. **MCP server runs its two jobs** (see §5): (a) **Slack notification webhook** to the project's channel (e.g., "SRS approved by human"), and (b) **DynamoDB write** recording the update in the Project Tracker DB.
5. **Parallel trigger path (GitHub agent):** the artifact and the updated `project-progress.md` are committed to GitHub; a GitHub agent reads the commit, and if `project-progress.md` changed with **macro-gate lingo**, it verifies the gate was completed and runs the same two steps (Slack + DB).
6. **Micro updates** (small progress, e.g., "domain decomposition done") are logged to the DB the same way **without** the human gate — macro/micro is a classification on each record, not a separate check (see §4).
7. **Quick dashboard & reporting** reads the DB for cross-project status.

> Maps onto the swimlane as: *Generate Artifact → Governance Hook → Commit to GitHub → Governance Validation (here, the GitHub agent confirming the gate completed) → Results Stored in DB → Dashboard.*

### Pathway 2 — Meeting-transcript governance *(DEFERRED — not required for now)*

> **Out of scope for this POC.** Captured for future reference only; no build work in the current effort.

1. PM uploads a meeting transcript into the GitHub repo.
2. Governance hook is triggered.
3. **Bedrock** analyses the transcript (AWS-native model access already used by Kiro).
4. Checklist / agenda validation runs against the analysis.
5. Results stored → dashboard (shared with Pathway 1).

## 4. The governance model: Macro vs Micro

Per the methodology diagram legend, the distinction is **who performs the check**:

- **Micro = a sub-agent check** (automated). Surfaced via an **MCP call** and logged to the Project Tracker DB. Examples: *"domain/workstream decomposition done,"* *"spec file validated."* Usually no loud Slack notification.
- **Macro = a human check / approval**. Surfaced via the **macro webhook** — logged to the DB **and** Slack-notified to the project channel. Example: *"SRS approved by human."*

Both are recorded; the difference is that macro events carry a human sign-off and trigger the Slack notification.

**Identifying micro vs macro:** the canonical macro gates are defined in the methodology diagram (each marked *"Macro Gov"*) — enumerated in §4a. Classification should be driven off recognisable **macro-gate lingo** in the `project-progress.md` entry (e.g., "SRS approved", "code approved"), **plus a manual flag override** that can set or correct the classification per update.

> Note: in the source diagram "Mirco" is a typo for "Micro."

### 4a. Canonical macro gates (from the methodology diagram)

Each macro gate follows the same pattern: **Validate (sub-agent) → Review → Human approval → `orchestrator` calls MCP Server → Commit to Git → GitHub Agent updates Project Tracker DB → Slack notification.**

| Phase | Macro gate (human approval) | Validating sub-agent |
|---|---|---|
| 1 — Discover & Align | Discovery outputs / Preliminary SRS validated | `product-analyst` |
| 1 — Discover & Align | **SRS approved** | `product-analyst` |
| 2 — Design & Review | **Design docs / solution architecture approved** | `aws-architect` |
| 2 — Design & Review | **Implementation / sprint plan approved** (Quality Gate) | `plan-reviewer` |
| 3 — Build & Implement | **Spec file approved** (per `story-id`) | `executioner` |
| 3 — Build & Implement | **Code approved** | `code-reviewer` |
| 3 — Build & Implement | **UAT report approved** | `qa-agent` |
| 4 — Launch & Enable | **Runbooks / documentation approved** | `aws-architect` |
| 4 — Launch & Enable | **Project documentation approved** | `aws-architect` |

Two additional **automated** governance gates (sub-agent, not human) appear in Phase 2 and are recorded but not human-approved: a **Security Gate** and a **Compliance Gate**, run by `security-reviewer` (apply security, compliance & WAF checks).

## 5. The concrete near-term build: MCP server (2 jobs)

This is the spine of the POC. The MCP server is an **abstraction layer the Kiro agent calls as a tool**, with exactly two responsibilities:

1. **Slack API abstraction** — exposes a "notify Slack" capability. The agent calls it; the server handles the Slack API / incoming-webhook call. Notifications route to **the project's own Slack channel** (each project has a dedicated channel — the RAINN-type delivery-workflow tracking use case).
2. **DB call abstraction (webhook)** — exposes a "record progress" capability that writes to the **internal project-progress DB** via a webhook. The agent calls it to log each micro/macro update.

So a single agent action can both **log progress to the DB** and **notify the project channel**, without the agent needing to know Slack or DB internals.

**Source of truth for progress:** updates are driven off entries in a **`project-progress.md`** file. Each entry becomes a tracked record (micro or macro) in the progress DB.

### How a macro sign-off is captured (two trigger paths)

A macro event (e.g., "SRS approved by human") reaches the DB + Slack through **either** path — they run the same two MCP tools:

1. **Orchestrator hook path:** an explicit human-approval gate in the agent fires an `orchestrator` hook → the hook calls the MCP server tool → which performs (a) the **Slack notification webhook** and (b) the **DynamoDB update webhook**.
2. **GitHub-agent path:** a commit is read by a GitHub agent; if the commit contains a changed `project-progress.md`, the agent reads what changed, and **if it matches macro-gate lingo**, it runs the same two steps (Slack + DB).

### New requirement — explicit human-approval gate in the agents

The current Kiro app-dev agents **do not yet have an explicit human-approval gate**. We need to **add one**; the hook that drives the macro capture above triggers off that gate. Deliver this as a **branch + PR into the main app-dev agents**, and **pull the latest Kiro agents** before making changes.

Other notes:
- The **Kiro agent uses this MCP server directly** — Kiro has native MCP support, including remote servers, so notification/logging becomes an agent-callable action rather than a manual step.

## 6. Architecture & hosting

| Component | Role |
|---|---|
| Kiro sub-agents + agent hooks | Generate artifacts; trigger governance on events |
| GitHub | Artifact system of record; hook source |
| AWS Bedrock | *(Deferred with Pathway 2)* — transcript analysis; not required for this POC |
| MCP server | Agent-callable abstraction, two jobs: (1) Slack API call, (2) DynamoDB-write webhook. **Hosted on EC2 (AWS-native)** |
| GitHub agent / Action | Reads commits; parses `project-progress.md`; on macro-gate lingo, calls the MCP server tools |
| Slack (per-project channels) | Team notification & delivery tracking — **already configured per project** |
| Project Tracker DB (DynamoDB) | Tracks every project's progress as micro/macro update records |
| `project-progress.md` | Source of truth; entries become tracked DB records |
| Dashboard | Reporting & cross-project status |

**Hosting & cost — decision: EC2 (stay on AWS).** The team chose to keep everything on AWS, so the MCP server runs on **EC2 (~$8/mo base config)** rather than an npm-distributed stdio server. (The npm private-registry route at ~$7/mo was the cheapest option on paper, but staying AWS-native was preferred for consistency.) Cost context for the record:

- **EC2 base config — ~$8/mo** → **chosen** (AWS-native).
- npm private registry — ~$7/mo (stdio distribution) — not chosen.
- Fargate — viable but more than EC2 base for an always-on container.
- **DB → DynamoDB** (practically free; serverless). Aurora rejected as the most expensive option.

The GitHub-side parse step (reading `project-progress.md` on commit) can still run as a GitHub Action or as a process alongside the MCP server on the EC2 box.

### Suggested DynamoDB schema (single table)

| Field | Example | Notes |
|---|---|---|
| `PK` | `PROJECT#rainn` | Partition by project |
| `SK` | `UPDATE#2026-06-10T19:55Z#<ulid>` | Sortable by time |
| `update_text` | "SRS approved by human" | From `project-progress.md` |
| `type` | `macro` \| `micro` | Auto-classified; overridable |
| `flag_override` | `true`/`null` | Manual classification override |
| `gate` | "SRS Approval", "Security Gate" | Maps to methodology gate |
| `phase` | "Phase 1" | Optional, for dashboard grouping |
| `source_ref` | commit SHA / `project-progress.md#L42` | Provenance |
| `actor` | `aws-architect` / human name | Who emitted/approved |
| `created_at` | ISO timestamp | |

A GSI on `type` (or `gate`) supports the dashboard's cross-project rollups.

## 7. Decisions & recommendations

| Question | Decision / recommendation | Status |
|---|---|---|
| **Hosting** | **EC2 (~$8/mo base)** — stay AWS-native. npm (~$7/mo) was cheaper on paper but AWS consistency was preferred. GitHub parse step runs as a GitHub Action or alongside the server on EC2. | ✅ Decided |
| **Progress DB** | **DynamoDB** — practically free, serverless, fits the append-only record model. Aurora rejected (most expensive). Schema in §6. | ✅ Decided |
| **Micro/macro classification** | Canonical macro gates now **enumerated from the methodology diagram** (§4a) — 9 human-approval gates across Phases 1–4, plus Security & Compliance gates in Phase 2. Classify via macro-gate lingo in `project-progress.md` + a **manual flag override**. | ✅ Resolved (from diagram) |
| **`project-progress.md` → DB sync** | A **GitHub agent / Action** triggers on commit/merge, diffs the file, and on a macro-gate match calls the MCP server's two tools. (This is the "step 1" hook.) | ✅ Decided |
| **Macro sign-off capture** | Two paths to the same two MCP tools: (1) orchestrator hook off the human-approval gate, (2) GitHub agent reading a `project-progress.md` change. See §5. | ✅ Decided |
| **Human-approval gate in agents** | **Not present today — must be added.** Deliver as a **branch + PR** into the main app-dev agents; pull latest Kiro agents first. The hook triggers off this gate. | 🔨 New work item |
| **Slack provisioning** | **Already configured per project** — no action. | ✅ Resolved |
| **Auth/secrets** | Slack webhook URL + AWS creds for DynamoDB live in the agent/Action environment for the POC. Revisit centralised secrets if we move to a hosted endpoint later. | ⏳ To confirm |

---

*Source: Agentic Service Delivery Methodology diagram (Phases 0–4) + delivery discussion. Macro gates (§4a) extracted directly from the diagram's "Macro Gov" markers and the Human → Call MCP Server → GitHub Agent pattern. Hosting decided as EC2 (AWS-native). Cost figures (EC2 ~$8/mo base, npm ~$7/mo private registry, DynamoDB ~free, Aurora most expensive) per internal estimate. Kiro mechanics (event-driven hooks, delegated sub-agents with isolated context, native MCP support, CLI hooks, Bedrock model access) verified against current Kiro documentation.*
