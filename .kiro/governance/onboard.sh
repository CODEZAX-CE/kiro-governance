#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Kiro Governance — Project Onboarding Script
# Usage: ./onboard.sh <path-to-project-repo> <slack-webhook-url>
#
# What it does (steps 1-5):
#   1. Copies governance files into the project repo
#   2. Copies .kiro/mcp.json into the project repo
#   3. Sets GitHub Actions secrets (requires gh CLI + repo write access)
#   4. Stores Slack webhook in SSM
#   5. Prints a summary
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - aws CLI installed and configured (--profile sandbox)
#   - The three MCP secrets available as env vars or pulled from SSM
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────
PROJECT_REPO_PATH="${1:-}"
SLACK_WEBHOOK_URL="${2:-}"

if [[ -z "$PROJECT_REPO_PATH" || -z "$SLACK_WEBHOOK_URL" ]]; then
  echo "Usage: $0 <path-to-project-repo> <slack-webhook-url>"
  echo "Example: $0 ../my-client-project https://hooks.slack.com/services/..."
  exit 1
fi

if [[ ! -d "$PROJECT_REPO_PATH" ]]; then
  echo "Error: '$PROJECT_REPO_PATH' is not a directory"
  exit 1
fi

# ── Config ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_PROFILE="${AWS_PROFILE:-sandbox}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Resolve repo name from the target repo's git remote
REPO_NAME=$(cd "$PROJECT_REPO_PATH" && git remote get-url origin 2>/dev/null | sed 's/.*\/\([^.]*\)\.git$/\1/' || basename "$PROJECT_REPO_PATH")
GITHUB_REPO=$(cd "$PROJECT_REPO_PATH" && git remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]\(.*\)\.git$/\1/' || echo "")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kiro Governance Onboarding"
echo "  Project: $REPO_NAME"
echo "  Target:  $PROJECT_REPO_PATH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Copy governance files ────────────────────────────────────────────
echo "▶ Step 1/4: Copying governance files..."

# Create directories
mkdir -p "$PROJECT_REPO_PATH/.github/workflows"
mkdir -p "$PROJECT_REPO_PATH/.kiro/governance"

# Copy workflow (goes in .github/workflows for GitHub Actions to pick it up)
cp "$SCRIPT_DIR/governance-trigger.yml" "$PROJECT_REPO_PATH/.github/workflows/governance-trigger.yml"
echo "  ✓ .github/workflows/governance-trigger.yml"

# Copy trigger script into .kiro/governance (workflow references this path)
cp "$SCRIPT_DIR/governance-trigger.js" "$PROJECT_REPO_PATH/.kiro/governance/governance-trigger.js"
echo "  ✓ .kiro/governance/governance-trigger.js"

# ── Step 2: Copy .kiro/mcp.json ───────────────────────────────────────────────
echo ""
echo "▶ Step 2/4: Copying .kiro/mcp.json..."

cp "$SCRIPT_DIR/../mcp.json" "$PROJECT_REPO_PATH/.kiro/mcp.json"
echo "  ✓ .kiro/mcp.json"

# ── Step 3: Set GitHub Actions secrets ───────────────────────────────────────
echo ""
echo "▶ Step 3/4: Setting GitHub Actions secrets..."

# Pull MCP values from SSM if not already in env
if [[ -z "${MCP_SERVER_URL:-}" ]]; then
  MCP_SERVER_URL=$(aws ssm get-parameter \
    --name /kiro-governance/config/mcp-server-url \
    --with-decryption --region "$AWS_REGION" --profile "$AWS_PROFILE" \
    --query Parameter.Value --output text 2>/dev/null || echo "")
fi

if [[ -z "${MCP_API_KEY:-}" ]]; then
  MCP_API_KEY=$(aws ssm get-parameter \
    --name /kiro-governance/config/mcp-api-key \
    --with-decryption --region "$AWS_REGION" --profile "$AWS_PROFILE" \
    --query Parameter.Value --output text 2>/dev/null || echo "")
fi

if [[ -z "${MCP_CERT_FINGERPRINT:-}" ]]; then
  MCP_CERT_FINGERPRINT=$(aws ssm get-parameter \
    --name /kiro-governance/config/mcp-cert-fingerprint \
    --region "$AWS_REGION" --profile "$AWS_PROFILE" \
    --query Parameter.Value --output text 2>/dev/null || echo "")
fi

if [[ -z "$MCP_SERVER_URL" || -z "$MCP_API_KEY" || -z "$MCP_CERT_FINGERPRINT" ]]; then
  echo "  ⚠ Could not load MCP values from SSM."
  echo "  Set them manually as GitHub secrets:"
  echo "    MCP_SERVER_URL, MCP_API_KEY, MCP_CERT_FINGERPRINT"
  echo "  Or store them in SSM:"
  echo "    /kiro-governance/config/mcp-server-url"
  echo "    /kiro-governance/config/mcp-api-key"
  echo "    /kiro-governance/config/mcp-cert-fingerprint"
else
  if [[ -n "$GITHUB_REPO" ]]; then
    gh secret set MCP_SERVER_URL --body "$MCP_SERVER_URL" --repo "$GITHUB_REPO"
    echo "  ✓ MCP_SERVER_URL"
    gh secret set MCP_API_KEY --body "$MCP_API_KEY" --repo "$GITHUB_REPO"
    echo "  ✓ MCP_API_KEY"
    gh secret set MCP_CERT_FINGERPRINT --body "$MCP_CERT_FINGERPRINT" --repo "$GITHUB_REPO"
    echo "  ✓ MCP_CERT_FINGERPRINT"
  else
    echo "  ⚠ Could not determine GitHub repo. Set secrets manually in repo settings."
  fi
fi

# ── Step 4: Store Slack webhook in SSM ───────────────────────────────────────
echo ""
echo "▶ Step 4/4: Storing Slack webhook in SSM..."

aws ssm put-parameter \
  --name "/kiro-governance/slack/webhooks/$REPO_NAME" \
  --value "$SLACK_WEBHOOK_URL" \
  --type SecureString \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" \
  --overwrite \
  --no-cli-pager
echo "  ✓ /kiro-governance/slack/webhooks/$REPO_NAME"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Governance onboarded for: $REPO_NAME"
echo ""
echo "  Next steps:"
echo "  1. Commit and push the new files in $PROJECT_REPO_PATH:"
echo "     git add .github/workflows/governance-trigger.yml"
echo "     git add .kiro/"
echo "     git commit -m 'chore: add kiro governance'"
echo "     git push origin main"
echo ""
echo "  2. Test by adding a macro gate line to docs/project-progress.md:"
echo "     echo '- [x] SRS approved by <name>' >> docs/project-progress.md"
echo "     git add docs/project-progress.md && git commit -m 'test: governance' && git push"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
