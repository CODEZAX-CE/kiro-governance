# KG-02 Code Review — EC2 Instance Provisioning + TLS Setup

**Date:** 2026-06-11T22:35:38Z  
**Reviewer:** code-reviewer-kg02  
**Files Reviewed:**
- `/infra/stacks/governance-stack.ts` (full implementation)
- `/infra/cdk.json` (context configuration)

**Review Against:**
1. `/specs/sprint-01/KG-02-ec2-setup-spec.md` — approved spec
2. `/docs/phase1/mcp-server-core-architecture.md` — F-01 §2, §8
3. `/docs/code-structure.md` — CDK patterns §10
4. Backend standards — CDK naming, no secrets, code organization

---

## Verdict: ✅ APPROVED

All acceptance criteria met. Implementation follows spec precisely and adheres to project standards.

---

## Detailed Findings

### ✅ VPC Configuration (§1.1, spec)

**Check:** Default VPC lookup via `Vpc.fromLookup`  
**Status:** ✅ PASS  
**Evidence:**
- Line 138: `const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });`
- Correct L2 construct usage
- No custom VPC creation

---

### ✅ Security Group — Port 443 (§1.2, spec)

**Check:** Inbound TCP 443 from 0.0.0.0/0  
**Status:** ✅ PASS  
**Evidence:**
- Line 153: `sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS MCP server');`
- Rationale documented: GitHub Actions dynamic IPs + Kiro agent
- Group name: `kiro-gov-mcp-server-sg` (line 148)

---

### ✅ Security Group — SSH from Admin CIDR (§1.2, spec)

**Check:** Inbound SSH (port 22) from `adminCidr` context only  
**Status:** ✅ PASS  
**Evidence:**
- Lines 141–143: Context check with error if missing
  ```typescript
  const adminCidr = this.node.tryGetContext('adminCidr');
  if (!adminCidr) {
    throw new Error('CDK context value adminCidr is required...');
  }
  ```
- Line 154: `sg.addIngressRule(ec2.Peer.ipv4(adminCidr), ec2.Port.tcp(22), 'SSH admin access');`
- Throws on missing context — enforces configuration
- ✅ **Spec compliance:** "throws if missing"

---

### ✅ EC2 Instance Type (§1.4, spec)

**Check:** L2 `ec2.Instance` construct, t3.micro, Amazon Linux 2023  
**Status:** ✅ PASS  
**Evidence:**
- Line 192: `const instance = new ec2.Instance(this, 'McpServer', {`
- Line 194: `instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),`
- Line 195: `machineImage: ec2.MachineImage.latestAmazonLinux2023(),`
- L2 construct (not L1 CfnInstance)
- Correct instance type and latest AL2023 AMI

---

### ✅ IAM Role Usage (§1.4, spec)

**Check:** Uses `this.mcpServerRole` from KG-01, not a new role  
**Status:** ✅ PASS  
**Evidence:**
- Line 197: `role: this.mcpServerRole,`
- Role created in KG-01 (line 70: `this.mcpServerRole = new iam.Role(...)`)
- Instance profile created and associated (lines 131–134):
  ```typescript
  const instanceProfile = new iam.InstanceProfile(this, 'McpServerInstanceProfile', {
    role: this.mcpServerRole,
  });
  ```
- ✅ **Spec compliance:** "this.mcpServerRole (not a new role, not CfnInstance iamInstanceProfile)"

---

### ✅ User Data — TLS Certificate (§1.5, spec)

**Check:** Self-signed cert at `/opt/kiro-governance/cert.pem`, idempotency guard, RSA 4096, 365-day validity  
**Status:** ✅ PASS  
**Evidence:**
- Lines 171–180: Idempotent TLS cert generation
  ```typescript
  'if [ ! -f /opt/kiro-governance/cert.pem ]; then',
  '  openssl req -x509 -newkey rsa:4096 \\',
  '    -keyout /opt/kiro-governance/key.pem \\',
  '    -out /opt/kiro-governance/cert.pem \\',
  '    -days 365 -nodes \\',
  '    -subj "/CN=kiro-governance"',
  '  chmod 600 /opt/kiro-governance/key.pem',
  '  chmod 644 /opt/kiro-governance/cert.pem',
  'fi',
  ```
- ✅ Idempotency guard: `if [ ! -f ... ]; then`
- ✅ RSA 4096-bit: `-newkey rsa:4096`
- ✅ 365-day validity: `-days 365`
- ✅ Path: `/opt/kiro-governance/cert.pem`
- ✅ Key permissions: `chmod 600` (readable only by owner)
- ✅ Cert permissions: `chmod 644` (world-readable for fingerprint extraction)

---

### ✅ User Data — Node.js 20 (§1.5, spec)

**Check:** Node.js 20 LTS installed via nvm  
**Status:** ✅ PASS  
**Evidence:**
- Lines 160–167: nvm installation and Node.js 20 setup
  ```typescript
  'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
  'export NVM_DIR="/root/.nvm"',
  '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
  'nvm install 20',
  'nvm use 20',
  'nvm alias default 20',
  ```
- ✅ Correct nvm version pinned (v0.39.7)
- ✅ nvm correctly sourced in shell
- ✅ Node.js 20 installed and aliased as default

---

### ✅ User Data — PM2 Absent (§1.5, spec)

**Check:** PM2 not mentioned in user data (systemd for KG-03)  
**Status:** ✅ PASS  
**Evidence:**
- No `npm install -g pm2` or `pm2 start` commands in user data
- ✅ **Spec compliance:** "PM2 absent, nvm/Node.js 20 installed"
- Service orchestration deferred to KG-03 as per spec

---

### ✅ Elastic IP (§1.3 & 1.6, spec)

**Check:** Allocated, associated with instance, output as `ElasticIP`  
**Status:** ✅ PASS  
**Evidence:**
- Line 207: `const eip = new ec2.CfnEIP(this, 'McpServerEip', { domain: 'vpc' });`
- Lines 208–211: Association
  ```typescript
  new ec2.CfnEIPAssociation(this, 'McpServerEipAssoc', {
    instanceId: instance.instanceId,
    allocationId: eip.attrAllocationId,
  });
  ```
- Lines 280–285: CloudFormation output
  ```typescript
  new cdk.CfnOutput(this, 'ElasticIP', {
    value: eip.ref,
    description: 'MCP Server Elastic IP — use for MCP_SERVER_URL and SSH access',
    exportName: 'KiroGovernanceMcpServerEIP',
  });
  ```
- ✅ Output name matches spec: `ElasticIP`
- ✅ Exported for cross-stack reference

---

### ✅ EBS Volume Encryption (§1.4, spec)

**Check:** Root volume encrypted  
**Status:** ✅ PASS  
**Evidence:**
- Lines 200–203: EBS configuration with encryption
  ```typescript
  blockDevices: [{
    deviceName: '/dev/xvda',
    volume: ec2.BlockDeviceVolume.ebs(20, { encrypted: true }),
  }],
  ```
- ✅ Encryption enabled: `{ encrypted: true }`
- ✅ 20 GiB size (adequate for Node.js + logs)

---

### ✅ CDK Context — `adminCidr` (§2.1, spec)

**Check:** Placeholder `YOUR_IP/32` in cdk.json  
**Status:** ✅ PASS  
**Evidence:**
- `cdk.json` line 5: `"adminCidr": "YOUR_IP/32"`
- ✅ Correct placeholder format
- ✅ Error message clear (line 143): "CDK context value adminCidr is required..."

---

### ✅ KG-01 Resources Untouched (spec requirement)

**Check:** DynamoDB table, GSIs, role, SSM parameters, CloudWatch log group intact  
**Status:** ✅ PASS  
**Evidence:**
- Lines 28–65: DynamoDB table (from KG-01)
- Lines 67–65: GSI configurations (from KG-01)
- Lines 70–128: IAM role definition (from KG-01)
- Lines 216–238: SSM parameters (from KG-01)
- Lines 240–246: CloudWatch log group (from KG-01)
- ✅ No modifications to KG-01 code
- ✅ KG-02 additions cleanly appended (lines 135–212)

---

### ✅ No Hardcoded Secrets or IPs (spec requirement)

**Check:** No embedded API keys, passwords, or IPs except placeholders  
**Status:** ✅ PASS  
**Evidence:**
- Grep search for hardcoded values:
  - Line 153: `0.0.0.0/0` — intentional (spec compliance)
  - Line 184: `MCP_API_KEY=REPLACE_WITH_REAL_KEY` — placeholder in .env.example (correct)
  - Line 186: `TLS_KEY_PATH` — env var reference (correct)
- ✅ No AWS credentials, secrets, or private IPs embedded
- ✅ Sensitive values sourced from env vars or SSM

---

### ✅ EC2 Import Present (§1, spec)

**Check:** `import * as ec2` at top of file  
**Status:** ✅ PASS  
**Evidence:**
- Line 4: `import * as ec2 from 'aws-cdk-lib/aws-ec2';`
- All EC2 constructs correctly namespaced: `ec2.Instance`, `ec2.SecurityGroup`, `ec2.CfnEIP`

---

### ✅ Naming Conventions (code-structure.md §12)

**Check:** CDK constructs, variables, outputs follow project naming  
**Status:** ✅ PASS  
**Evidence:**
- Construct IDs: `McpServerSg`, `McpServer`, `McpServerEip` (PascalCase) ✅
- Variable names: `vpc`, `sg`, `adminCidr`, `eip` (camelCase) ✅
- Output names: `ElasticIP`, `McpServerInstanceId` (PascalCase) ✅
- Security group name: `kiro-gov-mcp-server-sg` (kebab-case, explicit name) ✅
- All aligned with code-structure.md §12 conventions

---

### ✅ Code Organization & Comments (code-structure.md §10, §13)

**Check:** Stack sections clearly marked, comments explain WHY  
**Status:** ✅ PASS  
**Evidence:**
- Sections marked with `// ==================== ... ====================` pattern
- Comments reference architecture docs and FRs (e.g., line 135: "// ==================== EC2 Instance (KG-02) ====================")
- Inline comments explain context requirements and security decisions
- Architect decision documentation present (e.g., line 141–143 error message)

---

## Architecture Compliance Review

### F-01 §2 Compliance (MCP Server — Technology & Hosting)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **t3.micro EC2 instance** | ✅ | Line 194: `InstanceClass.T3, InstanceSize.MICRO` |
| **Amazon Linux 2023** | ✅ | Line 195: `latestAmazonLinux2023()` |
| **Port 443 HTTPS** | ✅ | Line 153: TCP 443 inbound from 0.0.0.0/0 |
| **Self-signed TLS cert** | ✅ | Lines 171–180: openssl RSA 4096, 365-day cert |
| **Public Elastic IP** | ✅ | Lines 207–211: allocated and associated |
| **Node.js 20 LTS** | ✅ | Lines 160–167: nvm install 20 |
| **systemd service** | N/A | Deferred to KG-03 (per spec) |
| **SSH from admin CIDR** | ✅ | Lines 141–154: context validation + ingress rule |

### F-01 §8 Compliance (TLS & Security)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **TLS self-signed cert** | ✅ | Lines 171–180: generated in user data |
| **RSA 4096-bit** | ✅ | Line 172: `-newkey rsa:4096` |
| **365-day validity** | ✅ | Line 175: `-days 365` |
| **Idempotent generation** | ✅ | Line 171: `if [ ! -f ... ]; then` guard |
| **Path: /opt/kiro-governance/** | ✅ | Lines 174, 176: correct paths |
| **Permissions: key 600, cert 644** | ✅ | Lines 178–179: `chmod 600` and `chmod 644` |
| **Fingerprint extractable** | ✅ | Cert world-readable; no comment in user data needed |

---

## Specification Checklist (from review task)

- [x] VPC: default VPC via `Vpc.fromLookup` ✅
- [x] Security group: 443 from 0.0.0.0/0, SSH from `adminCidr` context (throws if missing) ✅
- [x] EC2: L2 `ec2.Instance`, t3.micro, Amazon Linux 2023 ✅
- [x] Role: `this.mcpServerRole` (not a new role, not CfnInstance iamInstanceProfile) ✅
- [x] User data: cert at `/opt/kiro-governance/cert.pem`, idempotency guard present, PM2 absent, nvm/Node.js 20 installed ✅
- [x] Elastic IP: allocated, associated with instance, output as `ElasticIP` ✅
- [x] EBS volume encrypted ✅
- [x] `adminCidr` in cdk.json as placeholder `YOUR_IP/32` ✅
- [x] KG-01 resources untouched ✅
- [x] No hardcoded IPs or secrets ✅
- [x] `ec2` import present ✅

---

## Strengths

1. **Precise spec adherence** — Implementation matches every detail of KG-02 spec
2. **Idempotency** — TLS cert generation guards against re-generation on restart
3. **Clear error messages** — Missing `adminCidr` context throws descriptive error
4. **Security-first design** — SSH restricted to admin CIDR, port 443 open but protected by API key + TLS
5. **Well-commented** — Architecture doc references and decision rationale documented
6. **No resource duplication** — EC2 additions cleanly integrated into existing KG-01 stack
7. **Proper role reuse** — EC2 instance assumes KG-01 role correctly via instance profile

---

## Non-Blocking Notes

1. **SSH key pair:** Implementation does not specify `keyName` for EC2 SSH access. Faraz must either:
   - Use Session Manager (recommended, no SSH key needed)
   - Provide `keyName` in cdk.context
   - Provision a separate key pair
   - **Impact:** None — this is post-deploy operational concern, not code issue

2. **User data verbosity:** User data is long but readable. Could extract to separate script file for reusability. Not required for POC.
   - **Impact:** None — spec met

3. **.env.example placement:** Placed on instance filesystem but not used by MCP server. Useful for reference only.
   - **Impact:** None — helpful for debugging

---

## Risk Assessment

| Risk | Severity | Mitigation | Status |
|------|----------|-----------|--------|
| Missing `adminCidr` blocks deployment | Medium | Error thrown early (line 143) | ✅ Mitigated |
| Port 443 open to internet | Medium | API key + TLS pinning required | ✅ Mitigated (by architecture) |
| Self-signed cert expires after 365 days | Low | Documented in runbook (future KG-14) | ✅ Mitigated (tracking) |
| Cert regeneration on instance restart | Low | Idempotency guard (line 171) | ✅ Mitigated |

---

## Conclusion

**KG-02 implementation is APPROVED for merge.**

All acceptance criteria from the spec are met:
- ✅ EC2 infrastructure correctly provisioned
- ✅ Security group configured per F-01 requirements
- ✅ TLS certificate generation idempotent and secure
- ✅ Node.js 20 LTS installed
- ✅ Elastic IP allocated and exported
- ✅ No hardcoded secrets or IPs
- ✅ Code follows project standards and naming conventions
- ✅ KG-01 resources untouched

The implementation is ready for deployment. Post-deploy manual steps documented in KG-02 spec §4 should be followed to extract cert fingerprint and configure GitHub secrets.

---

**Reviewer:** code-reviewer-kg02  
**Date:** 2026-06-11T22:35:38Z  
**Status:** ✅ APPROVED FOR MERGE
