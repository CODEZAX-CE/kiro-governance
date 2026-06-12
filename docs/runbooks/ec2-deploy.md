# Runbook: EC2 Deployment

**Purpose:** Deploy the MCP server to EC2 instance, including initial setup after CDK deployment and subsequent code updates.

**When to Run:**
- Initial deployment (after `cdk deploy`)
- Code updates (pull latest, rebuild, restart)
- Manual bug fixes or hotpatches

**Prerequisites:**
- SSH access to EC2 instance
- AWS credentials configured (for SSM parameter setup)
- GitHub repository cloned or available
- Node.js 20 LTS installed (normally via CDK user data)

---

## Initial Deployment (After `cdk deploy`)

### 1. SSH to EC2 Instance

```bash
ssh ec2-user@<elastic-ip>
```

### 2. Clone Repository

```bash
cd /opt
git clone <repo-url> kiro-governance
cd kiro-governance
```

**Replace `<repo-url>` with the actual repository URL**, e.g.:
```bash
git clone https://github.com/org/kiro-governance.git kiro-governance
```

### 3. Install Dependencies

```bash
npm ci
```

This uses the exact versions from `package-lock.json` (no `npm install`).

### 4. Build Packages

```bash
npm run build -w packages/mcp-server
```

This compiles TypeScript → JavaScript in `packages/mcp-server/dist/`.

### 5. Copy Distribution Files

```bash
cp -r packages/mcp-server/dist /opt/kiro-governance/dist
```

Ensures dist files are in the expected location for systemd service.

### 6. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` with real values:

```bash
nano .env
```

Required variables:

```bash
NODE_ENV=production
PORT=443
TLS_CERT_PATH=/opt/kiro-governance/cert.pem
TLS_KEY_PATH=/opt/kiro-governance/key.pem
LOG_LEVEL=info
AWS_REGION=us-east-1
```

**Note:** Do NOT commit `.env` — it contains secrets. Verify it's in `.gitignore`.

### 7. Set SSM Parameters

Store the API key in AWS Systems Manager Parameter Store (SecureString):

```bash
aws ssm put-parameter \
  --name /kiro-governance/config/mcp-api-key \
  --value '<api-key-secret>' \
  --type SecureString \
  --overwrite \
  --region us-east-1
```

**Replace `<api-key-secret>` with the actual API key** (match what's in GitHub Secrets `MCP_API_KEY`).

Verify the parameter was created:

```bash
aws ssm get-parameter \
  --name /kiro-governance/config/mcp-api-key \
  --with-decryption \
  --region us-east-1
```

### 8. Install systemd Service

```bash
sudo cp scripts/kiro-mcp-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable kiro-mcp-server
sudo systemctl start kiro-mcp-server
```

### 9. Verify Service Status

```bash
sudo systemctl status kiro-mcp-server
```

**Expected output:**
```
● kiro-mcp-server.service - Kiro Governance MCP Server
   Loaded: loaded (/etc/systemd/system/kiro-mcp-server.service; enabled)
   Active: active (running) since <timestamp>
```

### 10. Test Health Endpoint

```bash
curl -k https://localhost:443/health
```

**Expected response:**
```json
{"status":"ok","uptime":<seconds>}
```

### 11. Test MCP Tool Call

From a developer machine:

```bash
curl -X POST https://<elastic-ip>:443/mcp \
  -H "X-API-Key: <api-key>" \
  -H "Content-Type: application/json" \
  --data @- << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "record_progress",
    "arguments": {
      "project_id": "kiro-governance",
      "update_text": "Initial deployment test",
      "type": "micro",
      "source_ref": "runbook",
      "actor": "operator"
    }
  }
}
EOF
```

**Expected response:** `200 OK` with `{"written":true, "pk":"...", "sk":"..."}`.

---

## Code Update Deployment

Run this when code changes are merged to `main`:

### 1. SSH to EC2

```bash
ssh ec2-user@<elastic-ip>
cd /opt/kiro-governance
```

### 2. Pull Latest Code

```bash
git pull origin main
```

### 3. Install & Build

```bash
npm ci
npm run build -w packages/mcp-server
```

### 4. Restart Service

```bash
sudo systemctl restart kiro-mcp-server
```

### 5. Verify

```bash
sudo systemctl status kiro-mcp-server
curl -k https://localhost:443/health
```

---

## EC2 Auto-Recovery Alarm (Security Gate 2 REL-1)

Configure CloudWatch alarm to automatically recover the EC2 instance if system checks fail:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name kiro-gov-ec2-recovery \
  --metric-name StatusCheckFailed_System \
  --namespace AWS/EC2 \
  --dimensions Name=InstanceId,Value=<instance-id> \
  --statistic Maximum \
  --period 60 \
  --evaluation-periods 2 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions arn:aws:automate:us-east-1:ec2:recover \
  --region us-east-1
```

**Replace `<instance-id>` with the actual EC2 instance ID**, e.g., `i-0abc123def456`.

**What it does:**
- Monitors EC2 system-level status checks (hardware failures, network issues)
- If 2 consecutive checks (120 seconds) fail → automatically recovers the instance
- Recovery = stop and start (not reboot — full hardware reset)

**Verify alarm was created:**

```bash
aws cloudwatch describe-alarms \
  --alarm-names kiro-gov-ec2-recovery \
  --region us-east-1
```

Expected output shows:
- `StateValue: OK` (no issues currently)
- `AlarmActions: [arn:aws:automate:us-east-1:ec2:recover]`

---

## Troubleshooting

### Service Fails to Start

```bash
sudo systemctl status kiro-mcp-server
sudo journalctl -u kiro-mcp-server -n 50 --no-pager
```

**Common issues:**
- Missing `.env` file → create from `.env.example`
- Missing TLS certificate → regenerate with `openssl` (see cert-rotation.md)
- API key not in SSM → run step 7 above
- Port 443 already in use → check `sudo netstat -tuln | grep 443`

### Health Check Fails

```bash
curl -v -k https://localhost:443/health
```

**If connection refused:**
- Is the service running? `sudo systemctl status kiro-mcp-server`
- Is firewall blocking port 443? `sudo ufw status` (if ufw is installed)

### DynamoDB Write Fails

Check CloudWatch logs:

```bash
aws logs tail /kiro-governance/mcp-server --follow --region us-east-1
```

Look for errors like:
- `ValidationException: One or more parameter values were invalid`
- `AccessDeniedException` → IAM role lacks DynamoDB permissions

---

## Verification Checklist

- [ ] Repository cloned to `/opt/kiro-governance`
- [ ] Dependencies installed (`npm ci`)
- [ ] Packages built (`npm run build`)
- [ ] `.env` file created with real values
- [ ] API key stored in SSM Parameter Store
- [ ] systemd service installed and enabled
- [ ] Service status shows `active (running)`
- [ ] Health endpoint returns `200 OK`
- [ ] MCP tool call succeeds
- [ ] Auto-recovery alarm configured and in `OK` state
