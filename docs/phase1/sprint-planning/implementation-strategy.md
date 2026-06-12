# Implementation Strategy — kiro_governance

**Version:** 1.0
**Date:** 2026-06-11
**Author:** Technical PM
**Team:** 1 full-stack developer (Faraz)
**Development Model:** Spec-based (Kiro AI)

---

## 1. Project Overview

**kiro_governance** is a lightweight governance gate and notification layer around Kiro's agentic output. The POC proves the end-to-end governance loop on Pathway 1: agent produces artifact → human approves → progress logged to DynamoDB → Slack notification fires → dashboard shows status.

**Scope:** 9 functional requirements (FR-01 through FR-09), 4 features (F-01 through F-04), deployed on AWS with GitHub Actions integration.

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 20 LTS / TypeScript | MCP server, shared modules |
| Infrastructure | AWS CDK (TypeScript) | DynamoDB, IAM, SSM |
| Hosting | EC2 t3.micro (us-east-1) | MCP server with systemd |
| Database | DynamoDB (on-demand) | Append-only governance event store |
| CI/CD Trigger | GitHub Actions | `project-progress.md` diff → macro detection |
| Secrets | AWS SSM Parameter Store (SecureString) | Slack webhooks, API key |
| Notifications | Slack Incoming Webhooks | Per-project macro event alerts |
| Agent Protocol | MCP (Model Context Protocol) over HTTPS/SSE | Agent ↔ server communication |

---

## 3. Build Order

Strict dependency sequence based on feature dependencies (F-04 → F-01 → F-02 + F-03):

```
Sprint 1: Infrastructure + MCP Server Core
  ├── KG-01: CDK Stack (DynamoDB, IAM, SSM)
  ├── KG-02: EC2 Instance + TLS
  ├── KG-03: MCP Server scaffold
  ├── KG-04: record_progress tool
  └── KG-05: notify_slack tool

Sprint 2: Agent Integration + GitHub Trigger
  ├── KG-06: Human-approval gate
  ├── KG-07: Orchestrator hook
  ├── KG-08: Micro update logging
  └── KG-09: GitHub Actions workflow

Sprint 3: Validation + Runbooks
  ├── KG-13: End-to-end integration test via Kiro CLI
  └── KG-14: Runbooks + auto-recovery alarm
```

**Rationale:** Infrastructure must exist before the MCP server can write to DynamoDB. The MCP server must be running before agents or GitHub Actions can call it. Sprint 3 validates the full end-to-end flow and provides buffer for Sprint 2 overflow.

---

## 4. Spec-Based Development Approach

All stories follow the Kiro spec-based development model:

1. **Spec Creation** — Developer creates implementation spec referencing architecture doc
2. **Spec Review** — Plan reviewer validates spec against architecture doc
3. **Code Generation** — Kiro generates code from approved spec
4. **Code Review** — Code reviewer validates implementation matches spec + ACs
5. **Quality Gate** — Format, lint, type-check pass

**Effort reduction:** 40–50% less than traditional development for well-specified features. The architecture docs (F-01 through F-04) contain complete TypeScript interfaces, CDK constructs, and exact implementation logic — ideal for spec-based generation.

---

## 5. Sprint Planning

### Capacity

| Parameter | Value |
|-----------|-------|
| Developer | 1 (Faraz — full-stack) |
| Hours/day | 6 productive |
| Days/sprint | 5 (1 week) |
| Hours/sprint | 30 |
| Target pts/sprint | 15–20 (spec-based) |

### Sprint Allocation

| Sprint | Points | Focus |
|--------|--------|-------|
| Sprint 1 | 18 | Infrastructure (F-04) + MCP Server Core (F-01) |
| Sprint 2 | 16 | Agent Integration (F-02) + GitHub Trigger (F-03) |
| Sprint 3 | 7 | End-to-end Validation + Runbooks |

**Total:** 41 story points across 3 sprints (3 weeks).

---

## 6. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | EC2 MCP server unreachable from GitHub Actions (security group / IP issues) | Medium | High — blocks F-03 | Security group allows 0.0.0.0/0 on port 443 (F-01 §2.5). Test connectivity in KG-02. |
| 2 | Self-signed TLS cert fingerprint management across environments | Medium | Medium — blocks agent + GitHub integration | Automate fingerprint extraction in KG-02; document in runbook (KG-14). |
| 3 | Kiro agent MCP config format changes between versions | Low | Medium — blocks F-02 | Pull latest agents before KG-06 (SRS FR-06 AC). |

---

## 7. Timeline Estimate

### Spec-Based (Kiro) — Selected Approach

| Phase | Duration | Stories |
|-------|----------|---------|
| Sprint 1 | 1 week | KG-01 through KG-05 |
| Sprint 2 | 1 week | KG-06 through KG-09 |
| Sprint 3 | 1 week | KG-13, KG-14 |
| **Total** | **3 weeks** | 11 stories, 41 points |

### Traditional Development (Comparison)

| Phase | Duration | Rationale |
|-------|----------|-----------|
| Sprint 1 | 1.5–2 weeks | CDK + MCP server without spec-gen |
| Sprint 2 | 1.5 weeks | Agent hooks require manual prompt engineering |
| Sprint 3 | 1.5 weeks | Integration testing and runbooks |
| **Total** | **4.5–5 weeks** | ~45% longer than spec-based |

**Savings:** Spec-based development reduces timeline from ~5 weeks to 3 weeks (40% reduction), primarily on infrastructure (CDK boilerplate) and MCP server implementation (TypeScript interfaces fully defined in architecture docs).

---

## 8. Definition of Done (per Story)

- [ ] All acceptance criteria met (traceable to architecture doc)
- [ ] Implementation matches approved spec
- [ ] `npm run format && npm run lint && npm run type-check` pass
- [ ] Code reviewed and approved
- [ ] Changes committed and pushed

---

## 9. Infrastructure Cost

Monthly recurring cost: **~$8.47/mo** (post-deployment)

| Component | Cost |
|-----------|------|
| EC2 t3.micro | $8.47 |
| DynamoDB (free tier) | $0.00 |
| **Total** | **~$8.47** |

> Source: `docs/phase1/architecture/cost-estimate.md`

---

*End of Implementation Strategy v1.0*
