# Runbook: TLS Certificate Rotation

**Purpose:** Regenerate and rotate the self-signed TLS certificate used by the MCP server.

**When to Run:**
- Annually (certificate expires after 365 days)
- Immediately if certificate is compromised
- If certificate verification fails with pinning errors

**Prerequisites:**
- SSH access to EC2 instance (`kiro-mcp-server`)
- AWS credentials configured with access to GitHub Secrets (or GitHub Actions permissions)
- Admin access to update GitHub Encrypted Secrets

---

## Steps

### 1. Backup Old Certificate

```bash
ssh ec2-user@<elastic-ip>

cd /opt/kiro-governance
cp cert.pem cert.pem.bak
cp key.pem key.pem.bak
```

**Why:** Preserves the old certificate in case rollback is needed.

### 2. Remove Old Certificate

```bash
rm cert.pem key.pem
```

**Why:** Forces OpenSSL to generate a new certificate on next regeneration.

### 3. Regenerate Self-Signed Certificate

```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout /opt/kiro-governance/key.pem \
  -out /opt/kiro-governance/cert.pem \
  -days 365 -nodes \
  -subj "/CN=kiro-governance"
```

**Configuration:**
- RSA 4096-bit key (high security)
- 365-day validity
- Self-signed (no CA required)
- `-nodes` = no password encryption

### 4. Extract Certificate Fingerprint

```bash
openssl x509 -in /opt/kiro-governance/cert.pem -noout -fingerprint -sha256
```

**Example output:**
```
SHA256 Fingerprint=AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
```

**Copy the hex string without colons for the next steps.**

### 5. Update GitHub Encrypted Secret

Navigate to repository Settings → Secrets and variables → Actions → `MCP_CERT_FINGERPRINT`:

1. Click "Update secret"
2. Paste the new fingerprint (hex without colons)
3. Save

**Example new value:**
```
AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899
```

### 6. Update Developer Machines

On each developer machine running Kiro with the governance integration:

```bash
# Edit `.env` file
export MCP_CERT_FINGERPRINT="AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899"

# Also update `.kiro/mcp.json` if manually configured
# (usually generated from .env, so `.env` update is sufficient)
```

**Verify:**
```bash
# Test local mcp.json can resolve the new fingerprint
cat .kiro/mcp.json | grep -i fingerprint
```

### 7. Restart MCP Server

```bash
# On EC2 instance
sudo systemctl restart kiro-mcp-server

# Monitor restart
sudo systemctl status kiro-mcp-server
```

**Expected output:**
```
● kiro-mcp-server.service - Kiro Governance MCP Server
   Loaded: loaded (/etc/systemd/system/kiro-mcp-server.service; enabled; vendor preset: enabled)
   Active: active (running) since <timestamp>
```

### 8. Verify Certificate

Test health endpoint from EC2:

```bash
curl -k https://localhost:443/health
```

**Expected response:**
```json
{"status":"ok","uptime":<seconds>}
```

The `-k` flag skips verification (we're testing locally). A 200 response confirms the server restarted successfully with the new certificate.

### 9. Test MCP Tool Call

From a developer machine:

```bash
# Call record_progress tool via updated MCP server
kiro --help  # Ensure Kiro CLI is available

# Trigger a governance event (e.g., via Kiro agent workflow)
# or make a direct HTTPS call:

curl -X POST https://<elastic-ip>:443/mcp \
  -H "X-API-Key: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "record_progress",
      "arguments": {
        "project_id": "kiro-governance",
        "update_text": "Certificate rotation test",
        "type": "micro",
        "source_ref": "runbook",
        "actor": "operator"
      }
    }
  }'
```

**Expected response:** `200 OK` with MCP tool result (not a TLS error).

---

## Rollback

If the new certificate causes issues:

```bash
# On EC2 instance
cd /opt/kiro-governance
cp cert.pem.bak cert.pem
cp key.pem.bak key.pem
sudo systemctl restart kiro-mcp-server

# Revert GitHub Secret to old fingerprint
# (via GitHub UI or CLI)

# Notify team to revert `.env` files
```

---

## Verification Checklist

- [ ] Old certificate backed up
- [ ] New certificate generated (365-day validity)
- [ ] New fingerprint extracted
- [ ] GitHub Secret `MCP_CERT_FINGERPRINT` updated
- [ ] Developer machines notified to update `.env`
- [ ] MCP server restarted (`systemctl status` shows `active`)
- [ ] Health check returns 200 OK
- [ ] MCP tool call succeeds (no TLS errors)
- [ ] DynamoDB shows new event records (if tested)
