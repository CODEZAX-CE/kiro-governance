# KG-13 End-to-End Integration Test Runbook

**Jira Story:** KG-13  
**Sprint:** Sprint 3  
**Feature:** Integration & Validation  
**Acceptance Criteria:** Validate full Pathway 1 flow (agent → approval → MCP → DynamoDB → Slack + GitHub Actions dedup)

---

## 1. Pre-Conditions (Setup Required)

Before running this test suite, verify:

### 1.1 MCP Server Running

```bash
# On EC2 instance (SSH)
systemctl status kiro-mcp-server
# Expected: active (running)

# Verify endpoint reachable
curl -k -H "X-API-Key: <api-key>" https://<ec2-elastic-ip>:443/health
# Expected: 200 { "status": "ok", "uptime": ... }
```

**Notes:**
- Replace `<ec2-elastic-ip>` with the Elastic IP assigned to the EC2 instance
- Replace `<api-key>` with the value from SSM `/kiro-governance/config/mcp-api-key`
- Use `-k` flag with curl to skip CA verification (self-signed cert)

### 1.2 Agent Environment Variables

Set these in your local `.env` file or shell session:

```bash
KIRO_GOV_MCP_URL=https://<ec2-elastic-ip>:443/mcp
KIRO_GOV_MCP_API_KEY=<api-key-from-ssm>
MCP_CERT_FINGERPRINT=<sha256-fingerprint>
KIRO_PROJECT_ID=rainn  # Example: GitHub repo name
```

**How to get cert fingerprint:**
```bash
# On EC2 instance
openssl x509 -in /opt/kiro-governance/cert.pem -noout -fingerprint -sha256
# Output: sha256 Fingerprint=AA:BB:CC:...
# Use the hex part (AA:BB:CC:...) as MCP_CERT_FINGERPRINT
```

### 1.3 GitHub Actions Secrets Set

Verify these secrets exist in the GitHub repository settings (Settings → Secrets and variables → Actions):

| Secret | Value | How to Set |
|--------|-------|-----------|
| `MCP_SERVER_URL` | `https://<ec2-elastic-ip>:443/mcp` | Set by repo admin via GitHub UI |
| `MCP_API_KEY` | Same as SSM `/kiro-governance/config/mcp-api-key` | Set by repo admin via GitHub UI |
| `MCP_CERT_FINGERPRINT` | SHA-256 fingerprint (colon-delimited) | Set by repo admin via GitHub UI |

**Verification:** In GitHub repository, go to Settings → Secrets and variables → Actions. All three secrets should be listed (values hidden).

### 1.4 DynamoDB Table Access

Verify your AWS profile can query the DynamoDB table:

```bash
# Using your sandbox AWS profile
aws dynamodb describe-table \
  --table-name kiro-governance-tracker \
  --region us-east-1 \
  --profile sandbox

# Expected: Returns table metadata (status: ACTIVE, etc.)
```

### 1.5 Slack Webhook Configured

Verify the webhook URL is set in SSM:

```bash
aws ssm get-parameter \
  --name /kiro-governance/slack/webhooks/rainn \
  --with-decryption \
  --region us-east-1 \
  --profile sandbox

# Expected: Returns the webhook URL
```

**If missing, set it:**
```bash
aws ssm put-parameter \
  --name /kiro-governance/slack/webhooks/rainn \
  --value "https://hooks.slack.com/services/T.../B.../..." \
  --type SecureString \
  --region us-east-1 \
  --profile sandbox
```

Obtain the webhook URL from your Slack workspace (Slack admin → Apps → Incoming Webhooks).

---

## 2. Test 1: Orchestrator Path (Approval Flow)

**Objective:** Verify the agent-driven approval flow triggers MCP calls, writes to DynamoDB, and sends Slack notification.

### 2.1 Setup

1. In your Kiro CLI session, start a new chat:
   ```bash
   kiro-cli chat
   ```

2. Initialize the context:
   ```
   User: I'm running an integration test for KG-13. 
   I have a governance feature to review at the "SRS approved" gate. 
   The artifact is a test document at docs/test-srs.md. 
   Please simulate the orchestrator approval flow for this gate.
   ```

3. The Kiro agent (orchestrator) should:
   - Recognize the "SRS approved" macro gate
   - Ask you to review the artifact
   - Present gate information (artifact path, gate name, phase)
   - Prompt: "Approve or reject for gate SRS approved?"

### 2.2 Approval Action

When prompted, respond:
```
approve
```

**Expected outcome:**
- Agent calls `record_progress` MCP tool with:
  - `project_id`: resolved from `KIRO_PROJECT_ID` or git remote
  - `update_text`: "SRS approved by [your-git-username]"
  - `type`: "macro"
  - `gate`: "SRS approved"
  - `source_ref`: "docs/test-srs.md"
  - `actor`: your git username
- If successful: Agent calls `notify_slack` tool
- Agent logs: "Governance gate recorded and notified"

### 2.3 Verification — DynamoDB Record

Query DynamoDB for the new record (within 2-3 seconds of approval):

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}}' \
  --region us-east-1 \
  --profile sandbox | jq '.Items[] | select(.sk.S | contains("UPDATE#"))'
```

**Expected result:**
- One item with:
  - `pk`: "PROJECT#rainn"
  - `sk`: "UPDATE#<timestamp>#<ULID>"
  - `type`: "macro"
  - `gate`: "SRS approved"
  - `update_text`: "SRS approved by [your-name]"
  - `source_ref`: "docs/test-srs.md"
  - `actor`: [your-git-username]
  - `created_at`: ISO timestamp (current)

### 2.4 Verification — Slack Notification

Check your Slack workspace's project channel (e.g., #rainn-governance):

**Expected message:**
```
🏁 *[rainn]* SRS approved by [your-name] — artifact: docs/test-srs.md
```

### 2.5 Pass/Fail Criteria

| Check | Pass | Fail |
|-------|------|------|
| MCP tool calls execute without error | Agent reports success | Agent logs connection error or MCP failure |
| DynamoDB record exists | 1 record with correct gate + timestamp | 0 records or record with wrong gate |
| Slack message posted | Message visible in channel within 5 seconds | No message in channel or 404 from Slack |
| `created_at` timestamp | Within ±1 second of approval action | Timestamp absent or stale |

**Test 1 Result:** ✅ PASS / ❌ FAIL

---

## 3. Test 2: GitHub Actions Path

**Objective:** Verify the GitHub Actions workflow detects macro-gate lingo in a commit to `project-progress.md` and triggers MCP calls.

### 3.1 Setup

1. Check out a new branch:
   ```bash
   git checkout -b test/kg-13-github-trigger
   ```

2. Add a macro-gate entry to `docs/project-progress.md`:
   ```bash
   echo "2026-06-12: Design docs approved by lead architect" >> docs/project-progress.md
   ```

3. Commit and push:
   ```bash
   git add docs/project-progress.md
   git commit -m "Test: Add macro-gate entry for workflow trigger"
   git push -u origin test/kg-13-github-trigger
   ```

4. Create a pull request to `main` (or merge to main if authorized):
   ```bash
   gh pr create --title "Test KG-13: Trigger GitHub Actions workflow" --body "Merge to main to trigger governance workflow"
   ```

5. Merge the PR (or ask another user to merge):
   ```bash
   gh pr merge <pr-number> --merge
   ```

### 3.2 Workflow Execution

The `.github/workflows/governance-trigger.yml` workflow should auto-trigger when the PR is merged to `main`.

**Monitor workflow execution:**

```bash
# In GitHub CLI
gh run list --workflow governance-trigger.yml --limit 1

# Watch logs
gh run view <run-id> --log
```

**Expected workflow log output:**
```
Found 1 macro-gate entries.
Processing gate: "Design docs approved" from line: "2026-06-12: Design docs approved by lead architect"
  → Recorded and notified.
```

### 3.3 Verification — DynamoDB Record (GitHub Path)

Query for the new record (within 5 seconds of workflow completion):

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}}' \
  --region us-east-1 \
  --profile sandbox | jq '.Items[] | select(.sk.S | contains("UPDATE#"))'
```

**Expected result:**
- New item with:
  - `gate`: "Design docs approved"
  - `update_text`: "2026-06-12: Design docs approved by lead architect"
  - `source_ref`: commit SHA (short form visible in logs)
  - `actor`: GitHub username (github.actor)
  - `type`: "macro"

### 3.4 Verification — Slack (GitHub Path)

Check project Slack channel for a new message:

**Expected message:**
```
🏁 *[rainn]* Design docs approved — committed by <github-user> (ref: <short-sha>)
```

### 3.5 Pass/Fail Criteria

| Check | Pass | Fail |
|-------|------|------|
| Workflow triggers on main push | Workflow appears in run history | Workflow never runs (check path filter) |
| Workflow completes successfully | Exit code 0, "Recorded and notified" in logs | Exit code 1 or "ERROR" in logs |
| DynamoDB record written | 1 new record with correct gate | 0 records or wrong gate |
| Slack notification sent | Message in channel within 5 seconds | No message or workflow never reached Slack step |

**Test 2 Result:** ✅ PASS / ❌ FAIL

---

## 4. Test 3: Deduplication Verification

**Objective:** Verify that firing the same gate twice (via both pathways or rapid re-trigger) produces only ONE DynamoDB record and ONE Slack notification.

### 4.1 Setup

1. Note the exact gate and date from Test 1 (e.g., "SRS approved" on 2026-06-12)
2. Prepare to re-trigger the same gate via the agent

### 4.2 Trigger Same Gate Again (Orchestrator Path)

In Kiro CLI, repeat the approval flow for the same gate:

```
User: Run the SRS approved gate again with the same date (2026-06-12) 
to test deduplication.
```

Agent should:
- Prompt for approval
- Call `record_progress` with same project_id + gate + date
- Receive: `{ written: false, reason: 'duplicate' }`
- Log: "Already recorded (likely by GitHub Actions path). Proceeding."
- **NOT call `notify_slack`**

### 4.3 DynamoDB Verification

Count records for the gate:

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}}' \
  --region us-east-1 \
  --profile sandbox | jq '[.Items[] | select(.gate.S == "SRS approved")] | length'
```

**Expected result:**
- Count = 1 (only the first approval is recorded; second is dedup'd)

### 4.4 Slack Verification

Check Slack for duplicate messages:

```
Search project channel for: "SRS approved"
Expected: Exactly 1 message (the one from Test 1 or Test 2)
```

### 4.5 DynamoDB Dedup Sentinel Verification

Query the dedup sentinel (proof of dedup check):

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --index-name gsi-gate-created \
  --key-condition-expression "gate = :g" \
  --expression-attribute-values '{":g": {"S": "SRS approved"}}' \
  --region us-east-1 \
  --profile sandbox | jq '.Items[] | select(.sk.S | contains("DEDUP#"))'
```

**Expected result:**
- 1 sentinel item with `sk` = "DEDUP#rainn#srs approved#2026-06-12"

> Note: Sentinel PK is "PROJECT#rainn", SK is "DEDUP#<idempotency_key>". It confirms the first writer won.

### 4.6 Pass/Fail Criteria

| Check | Pass | Fail |
|-------|------|------|
| Second `record_progress` returns duplicate | Response is `{ written: false, reason: 'duplicate' }` | Response is `{ written: true }` (dedup failed) |
| No Slack re-notification on duplicate | Slack channel still has 1 message | Slack channel has 2+ messages for same gate |
| DynamoDB record count | 1 record for the gate | 2+ records (duplication occurred) |
| Dedup sentinel written | Sentinel item exists in DynamoDB | Sentinel absent (dedup logic not running) |

**Test 3 Result:** ✅ PASS / ❌ FAIL

---

## 5. Test 4: Micro Event Logging

**Objective:** Verify sub-agents can log micro updates via MCP without triggering human gates or Slack notifications.

### 5.1 Setup

1. In Kiro CLI, ask the agent to simulate a sub-agent micro event:
   ```
   User: I'm testing micro event logging. 
   Please simulate the aws-architect sub-agent logging a micro event: 
   "Domain decomposition done" for project rainn.
   ```

2. The orchestrator should:
   - Call `record_progress` with:
     - `type`: "micro"
     - `update_text`: "Domain decomposition done"
     - `source_ref`: "N/A" or file path
     - `actor`: "aws-architect"
   - **NOT call `notify_slack`** (micro events skip Slack)

### 5.2 Verification — DynamoDB Record

Query for micro event:

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}}' \
  --region us-east-1 \
  --profile sandbox | jq '.Items[] | select(.type.S == "micro")'
```

**Expected result:**
- 1 item with:
  - `type`: "micro"
  - `update_text`: "Domain decomposition done"
  - `actor`: "aws-architect"
  - `gate`: null or absent (micro has no gate)
  - `created_at`: current timestamp

### 5.3 Verification — No Slack Notification

Check Slack project channel:

```
Search for: "Domain decomposition"
Expected: No message in channel (micro events do not notify Slack)
```

### 5.4 Verification — No Dedup Sentinel

Attempt to query for a dedup sentinel matching the micro event:

```bash
aws dynamodb get-item \
  --table-name kiro-governance-tracker \
  --key '{"pk": {"S": "PROJECT#rainn"}, "sk": {"S": "DEDUP#rainn#micro#<any-ulid>"}}' \
  --region us-east-1 \
  --profile sandbox
```

**Expected result:**
- No item found (micro events use ULID-based keys and no sentinel dedup)

> Note: Micro events are dedup'd via ULID uniqueness, not a sentinel. Each call gets a unique ULID, so duplicate calls to micro events with identical parameters will write 2 records (not dedup'd). This is acceptable for micro events (best-effort logging).

### 5.5 Pass/Fail Criteria

| Check | Pass | Fail |
|-------|------|------|
| `record_progress` called with type: "micro" | MCP call succeeds with `written: true` | MCP call fails or type not "micro" |
| DynamoDB micro record exists | 1 record with `type: "micro"` | 0 records or `type: "macro"` |
| No Slack notification for micro | Channel has no message related to the micro event | Slack notification posted (should not happen) |
| No dedup sentinel created | Sentinel does not exist | Sentinel exists for micro (unexpected) |

**Test 4 Result:** ✅ PASS / ❌ FAIL

---

## 6. Test 5: Rejection Flow (No MCP Calls)

**Objective:** Verify that human rejection at a gate does NOT trigger MCP calls or write to DynamoDB/Slack.

### 6.1 Setup

1. In Kiro CLI, start another gate approval flow:
   ```
   User: I'm testing the rejection flow. 
   Present me with a new gate approval for "Code approved" 
   and I will reject it to test the non-recording path.
   ```

2. The orchestrator should:
   - Present the artifact and gate info
   - Prompt for approval/rejection
   - Wait for user response

### 6.2 Rejection Action

When prompted, respond:
```
reject: Incomplete code review — missing test coverage
```

**Expected behavior:**
- Agent receives rejection + feedback text
- Agent logs: "Artifact rejected. Returning to sub-agent for rework."
- Agent **DOES NOT** call `record_progress` or `notify_slack`
- Artifact returns to sub-agent (code-reviewer) for rework

### 6.3 Verification — No DynamoDB Record

Query for a record with gate "Code approved":

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --index-name gsi-gate-created \
  --key-condition-expression "gate = :g" \
  --expression-attribute-values '{":g": {"S": "Code approved"}}' \
  --region us-east-1 \
  --profile sandbox | jq '.Items[] | .gate.S'
```

**Expected result:**
- No items with gate "Code approved" (or pre-existing items, but not from this test)

> Note: If the gate "Code approved" has no prior records, the query returns an empty array.

### 6.4 Verification — No Slack Notification

Check Slack for "Code approved" messages:

```
Search project channel for: "Code approved"
Expected: No new message from this test
```

### 6.5 Pass/Fail Criteria

| Check | Pass | Fail |
|-------|------|------|
| No MCP calls fired on rejection | Agent logs show no `record_progress` or `notify_slack` calls | Agent calls MCP tools despite rejection |
| No DynamoDB record | Query returns no new record for "Code approved" gate | DynamoDB record exists with this gate from test time |
| No Slack message | No new message in project channel | Slack notification appears |
| Artifact returns to sub-agent | Agent indicates rework delegation | Artifact is closed or skipped |

**Test 5 Result:** ✅ PASS / ❌ FAIL

---

## 7. Expected Results Summary Table

| Test # | Flow | Expected Output | Outcome |
|--------|------|-----------------|---------|
| 1 | Orchestrator approval | DynamoDB record (1) + Slack notification | ✅ / ❌ |
| 2 | GitHub Actions workflow | DynamoDB record (1) + Slack notification | ✅ / ❌ |
| 3 | Dedup detection | 2nd call → `{ written: false }`, 1 record total, 1 Slack msg | ✅ / ❌ |
| 4 | Micro event | DynamoDB record (1) + NO Slack notification | ✅ / ❌ |
| 5 | Rejection | NO MPC calls, NO DynamoDB record, NO Slack | ✅ / ❌ |

---

## 8. How to Query DynamoDB Records

### 8.1 List All Records for a Project

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}}' \
  --region us-east-1 \
  --profile sandbox
```

### 8.2 Filter by Event Type

**Macro events only:**
```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --filter-expression "attribute_type(#t, :val) AND #t = :macro" \
  --expression-attribute-names '{"#t": "type"}' \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}, ":val": "S", ":macro": {"S": "macro"}}' \
  --region us-east-1 \
  --profile sandbox
```

**Micro events only:**
```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk" \
  --filter-expression "#t = :micro" \
  --expression-attribute-names '{"#t": "type"}' \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}, ":micro": {"S": "micro"}}' \
  --region us-east-1 \
  --profile sandbox
```

### 8.3 Find Dedup Sentinels

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --key-condition-expression "pk = :pk AND begins_with(sk, :dedup)" \
  --expression-attribute-values '{":pk": {"S": "PROJECT#rainn"}, ":dedup": {"S": "DEDUP#"}}' \
  --region us-east-1 \
  --profile sandbox
```

### 8.4 Count Records by Gate (GSI)

```bash
aws dynamodb query \
  --table-name kiro-governance-tracker \
  --index-name gsi-gate-created \
  --key-condition-expression "gate = :g" \
  --expression-attribute-values '{":g": {"S": "SRS approved"}}' \
  --region us-east-1 \
  --profile sandbox | jq '.Items | length'
```

---

## 9. How to Verify Slack Notifications

### 9.1 Manual Check

1. Open Slack workspace
2. Go to project channel (e.g., #rainn-governance)
3. Search for messages containing gate names or actor names
4. Verify message format: `🏁 *[project_id]* <message>`

### 9.2 Slack API Check (if using bot token)

```bash
# Requires Slack bot token with chat:history scope
curl -X GET "https://slack.com/api/conversations.history" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -G \
  -d "channel=C..." \
  -d "limit=10" | jq '.messages[] | select(.text | contains("SRS approved"))'
```

### 9.3 Expected Message Format

```
🏁 *[rainn]* SRS approved by john-doe — artifact: docs/test-srs.md
```

or (GitHub Actions):

```
🏁 *[rainn]* Design docs approved — committed by jane-smith (ref: a1b2c3d)
```

---

## 10. Pass/Fail Criteria (Overall)

**Test Suite Pass:** All 5 tests receive ✅ PASS

**Test Suite Fail:** Any test receives ❌ FAIL

### 10.1 Critical Failures (Blocking)

These failures require immediate resolution before the test suite is considered complete:

- **Test 1 Fail:** Orchestrator approval does not write to DynamoDB or post Slack (core flow broken)
- **Test 2 Fail:** GitHub Actions workflow does not trigger or does not call MCP server
- **Test 3 Fail:** Deduplication logic fails; duplicate records are written to DynamoDB
- **Test 5 Fail:** Rejection still records to DynamoDB/Slack (security/correctness issue)

### 10.2 Non-Critical Failures (Warning)

These may be acceptable depending on phase and scope:

- **Test 4 Fail:** Micro event logging is non-functional but does not block primary flow

---

## 11. Troubleshooting Guide

### Issue: MCP Server Unreachable

**Symptom:** Agent logs "Connection refused" or "ECONNREFUSED"

**Resolution:**
1. Verify EC2 instance is running:
   ```bash
   aws ec2 describe-instances --region us-east-1 --filters Name=tag:Name,Values=kiro-governance --profile sandbox
   ```
2. Verify systemd service is active:
   ```bash
   ssh -i <key> ec2-user@<elastic-ip> "systemctl status kiro-mcp-server"
   ```
3. Check security group allows port 443 from your IP:
   ```bash
   aws ec2 describe-security-groups --group-ids sg-xxx --region us-east-1 --profile sandbox
   ```

### Issue: DynamoDB Query Returns No Records

**Symptom:** Query for new records after approval returns empty items

**Resolution:**
1. Verify MCP tool call succeeded:
   - Check agent logs for "Recorded successfully" or similar
   - If agent reports failure, check MCP server logs: `ssh ... tail -f /var/log/kiro-mcp-server.log`
2. Verify DynamoDB table exists and has items:
   ```bash
   aws dynamodb describe-table --table-name kiro-governance-tracker --region us-east-1 --profile sandbox
   aws dynamodb scan --table-name kiro-governance-tracker --limit 5 --region us-east-1 --profile sandbox
   ```
3. Verify project_id matches table PK:
   - Expected PK: "PROJECT#rainn" (for project rainn)
   - If `KIRO_PROJECT_ID` env var is unset, git remote is parsed — verify with: `git remote get-url origin`

### Issue: Slack Webhook Rejected (403 / 404)

**Symptom:** Slack notification fails with status 403 or 404

**Resolution:**
1. Verify webhook URL is correct:
   ```bash
   aws ssm get-parameter --name /kiro-governance/slack/webhooks/rainn --with-decryption --region us-east-1 --profile sandbox
   ```
2. Test webhook URL manually:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"text": "Test message"}' \
     <webhook-url>
   # Expected: Returns 200 OK or 204 No Content
   ```
3. If webhook invalid, regenerate from Slack:
   - Slack workspace → Apps → Incoming Webhooks → Create New Webhook
   - Update SSM parameter with new URL

### Issue: GitHub Actions Workflow Fails

**Symptom:** Workflow exits with code 1, logs show "MCP call failed"

**Resolution:**
1. Check GitHub Actions log for error details:
   ```bash
   gh run view <run-id> --log
   ```
2. Verify GitHub Secrets are set:
   ```bash
   # In GitHub Settings → Secrets
   MCP_SERVER_URL=https://...
   MCP_API_KEY=...
   MCP_CERT_FINGERPRINT=...
   ```
3. Verify EC2 security group allows GitHub Actions IPs:
   - GitHub publishes IP ranges at `https://api.github.com/meta` (key: "actions")
   - Current example range: `140.82.112.0/20`, `143.55.64.0/20`, etc.
   - Add to EC2 security group inbound rule for port 443

### Issue: Deduplication Fails (Duplicate Records Written)

**Symptom:** Running same gate twice produces 2 DynamoDB records (dedup sentinel not working)

**Resolution:**
1. Check MCP server logs for dedup sentinel write:
   ```bash
   ssh ... tail -f /var/log/kiro-mcp-server.log | grep -i dedup
   ```
2. Verify DynamoDB conditional write logic:
   - MCP server must call `PutItem` with `ConditionExpression: "attribute_not_exists(pk)"`
   - Check F-01 §5.3 implementation
3. Verify date granularity in idempotency key:
   - Key format: `<project_id>#<gate>#<YYYY-MM-DD>`
   - Date must be the same for dedup to trigger
   - If tests run at 11:59 PM and 12:00 AM, dates differ → no dedup

---

## 12. Test Execution Checklist

Use this checklist to track test execution:

```
[ ] Pre-Conditions Verified
    [ ] MCP server running and reachable
    [ ] Agent environment variables set (.env or shell)
    [ ] GitHub Secrets configured
    [ ] DynamoDB table access verified
    [ ] Slack webhook configured

[ ] Test 1: Orchestrator Approval Flow
    [ ] Agent prompted for approval
    [ ] User responded "approve"
    [ ] MCP tools called successfully
    [ ] DynamoDB record written
    [ ] Slack notification posted
    [ ] Result: ✅ PASS / ❌ FAIL

[ ] Test 2: GitHub Actions Trigger
    [ ] Commit pushed to main with macro-gate lingo
    [ ] Workflow triggered (visible in GitHub Actions)
    [ ] Workflow completed successfully
    [ ] DynamoDB record written
    [ ] Slack notification posted
    [ ] Result: ✅ PASS / ❌ FAIL

[ ] Test 3: Deduplication Verification
    [ ] Same gate triggered twice
    [ ] Second call returned duplicate response
    [ ] Only 1 DynamoDB record exists
    [ ] Only 1 Slack notification in channel
    [ ] Dedup sentinel record verified
    [ ] Result: ✅ PASS / ❌ FAIL

[ ] Test 4: Micro Event Logging
    [ ] Micro event logged via agent
    [ ] DynamoDB record written with type: "micro"
    [ ] NO Slack notification sent
    [ ] No dedup sentinel created
    [ ] Result: ✅ PASS / ❌ FAIL

[ ] Test 5: Rejection Flow
    [ ] User responded "reject" to gate prompt
    [ ] NO MCP calls made
    [ ] NO DynamoDB record written
    [ ] NO Slack notification
    [ ] Result: ✅ PASS / ❌ FAIL

[ ] Summary: All 5 tests passed
```

---

## 13. Cleanup After Testing

After completing the test suite, remove test artifacts:

```bash
# Remove test commits from project-progress.md (if not desired)
git revert <commit-sha>
git push origin main

# Remove DynamoDB test records (OPTIONAL — archive instead if possible)
# DO NOT delete unless explicitly authorized by team lead

# Clean up temporary branches
git branch -d test/kg-13-github-trigger

# Clear Slack test messages (OPTIONAL — leave for audit trail)
```

---

## 14. Sign-Off

| Role | Name | Date | Sign-Off |
|------|------|------|----------|
| QA Lead | Faraz | — | [ ] Verified all tests pass |
| Backend Lead | — | — | [ ] Approved runbook + results |
| AWS Architect | — | — | [ ] Infrastructure validated |

---

*End of KG-13 Integration Test Runbook*
