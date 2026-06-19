# Kiro Governance

This folder contains everything needed to add governance to any project repo. Copy it in, run `onboard.sh`, and governance is live.

## Files

| File | Purpose |
|------|---------|
| `governance-trigger.yml` | GitHub Actions workflow — copy to `.github/workflows/` |
| `governance-trigger.js` | Self-contained trigger script — no npm install needed |
| `onboard.sh` | One-command onboarding for a new project |

## Onboarding a new project

```bash
# From the kiro-governance repo root:
.kiro/governance/onboard.sh <path-to-project-repo> <slack-webhook-url>

# Example:
.kiro/governance/onboard.sh ../my-client-project https://hooks.slack.com/services/XXX/YYY/ZZZ
```

That's it. The script:
1. Copies `governance-trigger.yml` → `<project>/.github/workflows/`
2. Copies `governance-trigger.js` → `<project>/.kiro/governance/`
3. Copies `mcp.json` → `<project>/.kiro/`
4. Sets GitHub Actions secrets (`MCP_SERVER_URL`, `MCP_API_KEY`, `MCP_CERT_FINGERPRINT`)
5. Stores the Slack webhook in SSM at `/kiro-governance/slack/webhooks/<repo-name>`

Then commit and push the new files in the project repo.

## How governance works

Any line added to `docs/project-progress.md` matching a macro gate name triggers:
1. `record_progress` → DynamoDB write (with dedup)
2. `notify_slack` → Slack message with commit link

Macro gates: `SRS approved`, `Design docs approved`, `Code approved`, etc. (10 total — see `governance-trigger.js`).

## Prerequisites

- `gh` CLI installed and authenticated
- `aws` CLI configured with `sandbox` profile (or set `AWS_PROFILE` env var)
- MCP shared values stored in SSM (one-time setup):
  ```bash
  aws ssm put-parameter --name /kiro-governance/config/mcp-server-url --value 'https://100.50.184.141' --type String --profile sandbox --region us-east-1
  aws ssm put-parameter --name /kiro-governance/config/mcp-cert-fingerprint --value '00:3D:18:...' --type String --profile sandbox --region us-east-1
  # mcp-api-key already stored as SecureString from initial setup
  ```
