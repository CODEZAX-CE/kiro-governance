# Kiro Governance — End-to-End Flow

```mermaid
flowchart TD
    subgraph DEV["Developer Machine"]
        AGENT["Kiro Sub-Agent\n(generates artifact)"]
        HUMAN["Human Reviewer"]
        ORCH["Orchestrator"]
    end

    subgraph REPO["GitHub Repo (per project)"]
        PM["docs/project-progress.md"]
        GHA[".github/workflows/\ngovernance-trigger.yml"]
        SCRIPT[".kiro/governance/\ngovernance-trigger.js"]
    end

    subgraph AWS["AWS (shared infrastructure)"]
        MCP["MCP Server\nEC2 t3.micro :443\nHTTPS + self-signed cert"]
        DB["DynamoDB\nkiro-governance-tracker"]
        SSM["SSM Parameter Store\n/kiro-governance/slack/webhooks/{repo}"]
    end

    SLACK["Slack\n#{project-channel}"]

    %% Orchestrator path
    AGENT -->|"produces artifact"| HUMAN
    HUMAN -->|"APPROVE"| ORCH
    ORCH -->|"record_progress +\nnotify_slack\n(X-API-Key, TLS pinned)"| MCP

    %% GitHub path
    ORCH -->|"commits project-progress.md"| PM
    PM -->|"push triggers workflow"| GHA
    GHA --> SCRIPT
    SCRIPT -->|"git diff → finds macro gate\nrecord_progress + notify_slack\n(X-API-Key, TLS pinned)"| MCP

    %% MCP server actions
    MCP -->|"conditional PutItem\n(dedup sentinel)"| DB
    MCP -->|"lookup webhook URL"| SSM
    SSM -->|"returns webhook URL"| MCP
    MCP -->|"POST {text: message}"| SLACK

    %% Dedup
    DB -.->|"{ written: false, reason: duplicate }\nskip Slack"| MCP

    style MCP fill:#FF9900,color:#000
    style DB fill:#7B68EE,color:#fff
    style SSM fill:#e8673a,color:#fff
    style SLACK fill:#4A154B,color:#fff
    style GHA fill:#24292e,color:#fff
    style SCRIPT fill:#24292e,color:#fff
```

## Flow summary

| Path | Trigger | Steps |
|------|---------|-------|
| **Orchestrator** | Human types APPROVE in Kiro CLI | Agent → Human approval → Orchestrator calls MCP directly |
| **GitHub Actions** | Push to main with `project-progress.md` change | Workflow diffs file → detects macro gate → calls MCP |
| **Both paths** | Either of the above | MCP writes to DynamoDB (dedup) → looks up Slack webhook from SSM → posts message |

## Onboarding a new project

```bash
.kiro/governance/onboard.sh <path-to-project-repo> <slack-webhook-url>
```
