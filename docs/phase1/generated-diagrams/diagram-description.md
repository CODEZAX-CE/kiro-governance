# Kiro Governance — Architecture Diagram Description

## Diagram File

`kiro-governance-architecture.drawio` — open in draw.io (desktop or web) to view.

---

## Numbered Flows

| # | Flow | Direction | Transport | Constraint |
|---|------|-----------|-----------|------------|
| 1 | Sub-agent generates artifact | Sub-Agent → Human Approval Gate | Internal (Kiro CLI) | — |
| 2 | Human approves at macro gate | Human Reviewer → Approval Gate → Orchestrator | Internal (Kiro CLI) | Macro events only |
| 3 | Orchestrator hook → MCP Server | Developer Machine → EC2 | HTTPS POST + X-API-Key + self-signed cert | Macro events |
| 4 | MCP Server → DynamoDB write | EC2 → DynamoDB | AWS SDK, conditional PutItem | All events (macro + micro) |
| 5 | MCP Server → Slack webhook | EC2 → Slack (external) | HTTPS POST to incoming webhook URL | Macro events only |
| 6 | Artifact committed → GitHub repo | Developer Machine → GitHub | git push (project-progress.md updated) | — |
| 7 | GitHub Actions triggers | GitHub repo change → GitHub Actions workflow | Push event on `docs/project-progress.md` path | Macro events only (lingo match) |
| 8 | Workflow → MCP Server | GitHub Actions → EC2 | HTTPS POST + X-API-Key + cert fingerprint pinning | Macro events only |
| 9 | MCP Server dedup check → DynamoDB | EC2 → DynamoDB | AWS SDK, conditional PutItem (attribute_not_exists) | Prevents duplicate if both paths fire |
| 10 | Micro events: sub-agent → MCP Server directly | Developer Machine → EC2 | HTTPS POST (dashed line = no human gate) | Micro events only, no Slack notification |

---

## Domains Shown

| Domain | Container | Key Services |
|--------|-----------|--------------|
| Agent Integration | Developer Machine (outside AWS) | Kiro Sub-Agent, Human Reviewer, Orchestrator, Human Approval Gate |
| MCP Server Core | AWS Cloud → Compute (EC2) | EC2 t3.micro running MCP server (classify, dedup, notify_slack, record_progress) |
| GitHub Trigger | GitHub group (outside AWS) | GitHub repo (project-progress.md), GitHub Actions (governance-trigger.yml) |
| Data & Persistence | AWS Cloud → Database | DynamoDB (kiro-governance-tracker) |

---

## Annotations

| Badge Color | Meaning | Applies To |
|-------------|---------|------------|
| Red (FFEBEE) | HTTPS/TLS security — self-signed cert or cert pinning | Flows 3, 8 |
| Yellow (FFF2CC) | Macro-only constraint — flow only fires for macro events | Flows 5, 7, 8 |
| Green (E8F5E9) | Conditional PutItem / dedup — prevents duplicate writes | Flows 4, 9 |
| Pink (FCE4EC) | SSM Parameter Store — config source for webhook URLs + API key | MCP Server |

---

## External Services

| Service | Integration | Direction |
|---------|-------------|-----------|
| Slack | Incoming webhook (per-project URL from SSM) | MCP Server → Slack (outbound HTTPS POST) |
| GitHub | Git push + GitHub Actions workflow | Developer → GitHub (push); GitHub Actions → MCP Server (HTTPS POST) |

---

## Security Notes Visible in Diagram

- All cross-network calls use HTTPS (self-signed cert for POC)
- GitHub Actions uses cert fingerprint pinning (checkServerIdentity)
- X-API-Key header on all inbound calls to MCP Server
- Conditional PutItem prevents duplicate governance records from dual-trigger path
- SSM Parameter Store holds secrets (webhook URLs, API key) — not environment variables
