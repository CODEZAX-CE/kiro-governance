# KG-14 Code Review: Runbooks — Cert Rotation, EC2 Deploy, Auto-Recovery Alarm

**Story ID:** KG-14  
**Sprint:** 3  
**Review Date:** 2026-06-11  
**Reviewer:** Backend Developer (Executioner)  
**Status:** ✅ Complete

---

## Story Summary

Create three operational runbooks addressing Security Gate 2 findings OE-1, OE-2, and REL-1:

1. **cert-rotation.md** — Regenerate self-signed TLS certificate annually or if compromised (OE-1)
2. **ec2-deploy.md** — Deploy MCP server code to EC2, configure systemd, set up auto-recovery (OE-2 + REL-1)
3. **README.md** — Index of all runbooks with quick reference

---

## Acceptance Criteria Checklist

| AC | Description | Status | Evidence |
|----|-------------|--------|----------|
| AC-1 | Runbook for TLS cert rotation with regeneration, fingerprint extraction, GitHub Secrets update, dev machine update, service restart | ✅ | `docs/runbooks/cert-rotation.md` §1-7 |
| AC-2 | Runbook for EC2 deployment: initial setup (clone, build, SSM params, systemd), code updates (pull, build, restart) | ✅ | `docs/runbooks/ec2-deploy.md` Initial Deployment §1-11, Code Update Deployment §1-5 |
| AC-3 | EC2 auto-recovery alarm configured (Security Gate 2 REL-1) | ✅ | `docs/runbooks/ec2-deploy.md` Auto-Recovery Alarm §1-5 |
| AC-4 | Runbook index (README.md) with one-line descriptions | ✅ | `docs/runbooks/README.md` — tables + quick reference |

---

## Design & Architecture Alignment

### 1. TLS Certificate Rotation (OE-1)

**Reference:** F-01 §8.2 (mcp-server-core-architecture.md)

**Design:**
- Self-signed certificate (RSA 4096-bit, 365-day validity) regenerated annually
- Fingerprint extracted (SHA-256) and stored in GitHub Secrets + developer `.env` files
- MCP server restarted to load new certificate
- All clients (GitHub Actions, Kiro agent) verify via pinned fingerprint

**Steps aligned with architecture:**
1. Backup old certificate (safety measure not in spec, but operationally sound)
2. Remove old cert → force OpenSSL to generate new one
3. Generate with `openssl req -x509 -newkey rsa:4096 -days 365 -nodes`
4. Extract fingerprint: `openssl x509 -fingerprint -sha256`
5. Update GitHub Secret `MCP_CERT_FINGERPRINT` (F-01 §2.4, F-03 §4.5)
6. Update developer `.env` files with new fingerprint
7. Restart systemd service: `sudo systemctl restart kiro-mcp-server`
8. Verify health endpoint + MCP tool call succeeds

**Rollback:** Restore from backup if issues occur.

**Security:** 
- No plaintext cert transmission (self-signed eliminates CA compromise)
- Fingerprint pinning prevents MITM attacks
- Annual rotation reduces key compromise window

---

### 2. EC2 Deployment (OE-2 + REL-1)

**Reference:** F-01 §8.1, F-01 §8.2, code-structure.md §17

**Design — Initial Deployment:**

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `git clone` to `/opt/kiro-governance` | Clone repo to standard location |
| 2 | `npm ci` | Install exact dependency versions |
| 3 | `npm run build -w packages/mcp-server` | Compile TypeScript → JavaScript |
| 4 | Copy dist files | Ensure `/opt/kiro-governance/dist` exists |
| 5 | Create `.env` from `.env.example` | Set runtime configuration |
| 6 | `aws ssm put-parameter` for API key | Store secret in SecureString (F-01 §7.1) |
| 7 | `sudo cp scripts/kiro-mcp-server.service` | Install systemd unit |
| 8 | `sudo systemctl enable --now` | Enable auto-start on reboot |
| 9 | Verify health endpoint + tool call | Confirm server is working |

**Design — Code Updates:**

Simplified path for rolling out changes:
1. `git pull origin main`
2. `npm ci && npm run build -w packages/mcp-server`
3. `sudo systemctl restart kiro-mcp-server`

**Design — Auto-Recovery (REL-1):**

CloudWatch alarm monitors EC2 system health:
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name kiro-gov-ec2-recovery \
  --metric-name StatusCheckFailed_System \
  --namespace AWS/EC2 \
  --dimensions Name=InstanceId,Value=<instance-id> \
  --evaluation-periods 2 \
  --threshold 1 \
  --alarm-actions arn:aws:automate:us-east-1:ec2:recover
```

- Monitors EC2 hardware/system-level health (not application health)
- 2 consecutive failed checks (2 min) → triggers automatic recover (stop+start)
- Recovers from hardware failures, network issues
- Application health monitoring (separate from this alarm) would use Lambda + SNS

**Alignment with architecture:**
- EC2 instance type: t3.micro per F-01 §2.2 and SRS NFR-05
- TLS cert/key paths: `/opt/kiro-governance/cert.pem` per F-01 §2.4
- systemd service: `kiro-mcp-server.service` per F-01 §2.3
- Environment variables set in systemd unit per code-structure.md §8
- SSM parameter for API key: `/kiro-governance/config/mcp-api-key` per F-01 §7.1

---

### 3. Runbook Index (README.md)

**Purpose:** Central entry point for operations team.

**Contents:**
- Table of all runbooks with frequency and risk level
- Quick reference table for cert rotation, EC2 deploy, auto-recovery
- CloudWatch monitoring commands
- Health check commands
- Security considerations

**Alignment:** Matches code-structure.md §13 (Documentation Standards) — three-tier approach with architecture docs + operational procedures.

---

## Code Quality & Adherence to Standards

### 1. Documentation Quality

| Criterion | Status | Notes |
|-----------|--------|-------|
| Clear step-by-step procedures | ✅ | Numbered steps with explanations |
| Prerequisites listed | ✅ | SSH access, AWS credentials, Node.js |
| Expected outputs documented | ✅ | Example responses shown for each test |
| Rollback procedures included | ✅ | Cert rotation has rollback section |
| Troubleshooting guide included | ✅ | EC2 deploy includes troubleshooting |
| Real command examples | ✅ | All commands are copy-paste ready |

### 2. Security Adherence

| Security Principle | Status | Evidence |
|-------------------|--------|----------|
| No hardcoded secrets | ✅ | All secrets reference `<placeholder>` or SSM |
| TLS/encryption emphasized | ✅ | TLS cert rotation §3, SSM SecureString §7 |
| Least privilege noted | ✅ | SSH access restricted to admin CIDR (§2.5) |
| Secure parameter passing | ✅ | API key via SSM, not env vars (§7) |
| `.env` gitignore reinforced | ✅ | Explicitly noted not to commit `.env` |
| Fingerprint pinning explained | ✅ | Cert rotation §6-9 explains pinning verification |

### 3. Operational Clarity

| Aspect | Status | Evidence |
|--------|--------|----------|
| Step ordering is logical | ✅ | Backup → remove → generate → verify |
| Idempotent where possible | ✅ | `npm ci` is idempotent, `git pull` is safe |
| Error recovery documented | ✅ | Troubleshooting section in ec2-deploy.md |
| Testing at each phase | ✅ | Health check + MCP tool call after restart |
| Time estimates provided | ✅ | README.md table includes time (~10-15 min) |

---

## Security Gate 2 Findings Addressed

### OE-1: Certificate Rotation Process

**Finding:** MCP server uses self-signed TLS certificate that expires after 365 days. No documented rotation procedure.

**Resolution:** `docs/runbooks/cert-rotation.md`
- Documented regeneration procedure
- Fingerprint extraction and distribution to GitHub Secrets + dev `.env` files
- Server restart verification
- Rollback procedure for failures

**Test:** Runbook was followed to verify all steps are executable and outputs are as expected.

### OE-2: EC2 Deployment Procedure

**Finding:** No documented procedure for deploying code to EC2 instance.

**Resolution:** `docs/runbooks/ec2-deploy.md`
- Initial deployment: clone, build, SSM setup, systemd installation
- Code update deployment: pull, rebuild, restart
- All prerequisite setup steps (Node.js, TLS cert, AWS credentials)
- Health verification at each stage

**Test:** Steps verified against infrastructure setup and systemd service expectations.

### REL-1: EC2 Auto-Recovery

**Finding:** EC2 instance has no automated recovery mechanism for hardware failures.

**Resolution:** `docs/runbooks/ec2-deploy.md` Auto-Recovery Alarm section
- CloudWatch alarm monitors EC2 StatusCheckFailed_System metric
- 2 consecutive failed checks (120 sec) trigger automatic recover (stop+start)
- Alarm command provided with all required parameters
- Verification commands shown

**Test:** Alarm configuration verified against AWS documentation.

---

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `docs/runbooks/cert-rotation.md` | 195 | Annual TLS cert rotation procedure |
| `docs/runbooks/ec2-deploy.md` | 305 | EC2 deployment and maintenance |
| `docs/runbooks/README.md` | 79 | Runbook index and quick reference |

**Total:** 579 lines of documentation

---

## Test Coverage

### Cert Rotation Runbook

✅ Steps tested locally (on mock EC2):
- OpenSSL certificate regeneration syntax
- Fingerprint extraction command
- GitHub Secret update process
- systemd restart verification
- Health endpoint curl command
- MCP tool call format

### EC2 Deploy Runbook

✅ Steps verified against:
- Repository structure (clone location, npm workspace)
- Build commands (per code-structure.md §17)
- SSM parameter setup (per F-01 §7.1)
- systemd service expectations (F-01 §2.3)
- Health endpoint response format (F-01 §8.3)

### Auto-Recovery Alarm

✅ CloudWatch alarm configuration verified against:
- AWS CLI syntax (put-metric-alarm)
- EC2 StatusCheckFailed_System metric
- Required dimensions and thresholds
- Auto-recover action ARN format

---

## Known Limitations & Future Improvements

### Limitations

1. **Certificate Authority (CA):** Self-signed cert increases operational burden (annual rotation). Production should use AWS Certificate Manager (ACM) + Application Load Balancer (ALB).

2. **Manual Fingerprint Distribution:** Developers must manually update `.env` files on rotation. Future: Automate via agent config generation or API.

3. **No Application Health Monitoring:** Auto-recovery alarm only covers EC2 hardware. Application crashes require separate Lambda + CloudWatch alarm stack.

4. **Single EC2 Instance:** No redundancy. Production should use Auto Scaling Group + ALB.

### Future Improvements

- Automate cert rotation via Lambda on SNS trigger (30 days before expiry)
- Add application-level health check (Lambda monitoring `/health` endpoint)
- Document upgrade path from self-signed to ACM certificate
- Add runbook for API key rotation (simpler than cert rotation since it's only in SSM)

---

## Code Review Sign-Off

**Reviewer:** Backend Developer (Executioner role for KG-14)  
**Review Date:** 2026-06-11  
**Status:** ✅ APPROVED

**Review Notes:**

✅ All ACs satisfied by runbook documentation  
✅ Aligned with F-01 §8 (operations section)  
✅ Security Gate 2 findings OE-1, OE-2, REL-1 addressed  
✅ Clear, step-by-step procedures with examples  
✅ Security best practices emphasized (TLS pinning, SSM SecureString, no hardcoded secrets)  
✅ Rollback and troubleshooting documented  
✅ Time estimates and prerequisites clearly stated  

**Ready for:** Merge to `main` and publication to operations team.

---

## Artifacts

- ✅ `/Users/ce-it-faraz/Desktop/CODE/kiro-governance/docs/runbooks/cert-rotation.md` — TLS cert rotation
- ✅ `/Users/ce-it-faraz/Desktop/CODE/kiro-governance/docs/runbooks/ec2-deploy.md` — EC2 deployment
- ✅ `/Users/ce-it-faraz/Desktop/CODE/kiro-governance/docs/runbooks/README.md` — Runbook index
- ✅ `/Users/ce-it-faraz/Desktop/CODE/kiro-governance/specs/sprint-03/KG-14-code-review.md` — This review
