# AWS Security Reviewer — Skills & Checklists

**Reference:** https://roadmap.sh/aws-best-practices, AWS Well-Architected Security Pillar

---

## 1. Security Foundations

### Account & Organization Security

- [ ] AWS Organizations with SCPs restricting dangerous actions
- [ ] Separate accounts for dev/staging/prod (or logical isolation)
- [ ] AWS root account MFA enabled, access keys deleted
- [ ] CloudTrail enabled in all regions with log file validation
- [ ] AWS Config enabled with conformance packs
- [ ] GuardDuty enabled in all regions
- [ ] Security Hub enabled with CIS/AWS Foundational benchmarks
- [ ] Trusted Advisor security checks reviewed

### Shared Responsibility Model

- Verify customer-side responsibilities are covered (not assumed AWS handles them)
- Document which security controls are AWS-managed vs customer-managed

---

## 2. Identity & Access Management (IAM)

### Authentication

- [ ] No root account usage for daily operations
- [ ] MFA enforced for all human users (TOTP preferred over SMS/email)
- [ ] Password policy: minimum length, complexity, rotation
- [ ] Cognito user pools: separate pools for different user types
- [ ] JWT token expiry ≤ 15 minutes with refresh token rotation
- [ ] Refresh token revocation on user deactivation (`AdminUserGlobalSignOut`)
- [ ] Service accounts: no human login, minimal permissions, no MFA bypass
- [ ] Federated identity: SAML/OIDC for enterprise users where applicable

### Authorization

- [ ] Least-privilege IAM policies — no wildcard `*` on sensitive services
- [ ] No inline policies where managed policies suffice
- [ ] Lambda execution roles: one role per function, minimal permissions
- [ ] Resource-based policies reviewed (S3 bucket policies, KMS key policies)
- [ ] Cross-account access uses external ID condition
- [ ] API Gateway authorizers validate JWT at edge (not in Lambda)
- [ ] Row-Level Security (RLS) at database level for multi-tenant apps
- [ ] Application-layer RBAC as defense-in-depth (not sole enforcement)

### Session Management

- [ ] Session timeout appropriate for data sensitivity (HIPAA: 15 min)
- [ ] Concurrent session handling defined
- [ ] Token revocation on role change / deactivation
- [ ] Screen lock/blur for PHI-accessing applications

---

## 3. Detection & Monitoring

### Logging

- [ ] CloudTrail: all regions, management + data events, S3 delivery
- [ ] CloudWatch Logs: all Lambda functions, API Gateway access logs
- [ ] VPC Flow Logs: enabled on all VPCs
- [ ] S3 access logging: enabled on sensitive buckets
- [ ] Log retention: meets compliance requirements (HIPAA: 6 years)
- [ ] Log integrity: S3 Object Lock or separate account
- [ ] No PII in log entries (masked in application logs)

### Threat Detection

- [ ] GuardDuty: enabled, findings routed to SNS/email
- [ ] GuardDuty Malware Protection: enabled for S3 buckets accepting uploads
- [ ] Security Hub: aggregating findings from GuardDuty, Inspector, Config
- [ ] CloudWatch alarms: failed login spikes, API error rate, unusual data access
- [ ] Budget alarms: detect denial-of-wallet attacks (especially LLM endpoints)

### Incident Response

- [ ] Incident classification defined (P1-P4)
- [ ] Escalation paths documented
- [ ] Runbooks for common incidents (compromised credentials, data breach, DDoS)
- [ ] Out-of-band alerting (SMS/phone for critical findings, not just email)
- [ ] Post-incident review process defined

---

## 4. Infrastructure Protection

### Network Security

- [ ] VPC with public/private/isolated subnet tiers
- [ ] No resources in public subnets unless required (ALB, NAT GW)
- [ ] Security groups: deny-all default, only required ports open
- [ ] No 0.0.0.0/0 ingress on port 22 or 3389
- [ ] VPC endpoints for S3, DynamoDB, Secrets Manager, SQS, SES, SNS
- [ ] NAT Gateway for outbound internet (Lambda in VPC)
- [ ] NACLs as additional layer where needed

### Edge Protection

- [ ] WAF on all public-facing endpoints (API Gateway, CloudFront, ALB)
- [ ] WAF rules: OWASP managed rules (SQLi, XSS, SSRF)
- [ ] WAF Bot Control for public endpoints (chatbots, public APIs)
- [ ] Rate limiting: per-IP and per-user/session
- [ ] CloudFront: HTTPS only, TLS 1.2+, security headers
- [ ] CORS: restricted to known domains (no wildcard)
- [ ] DDoS protection: Shield Standard (automatic), Shield Advanced if needed

### Compute Security

- [ ] Lambda: not in default VPC, execution role per function
- [ ] Lambda: no hardcoded secrets in environment variables
- [ ] Lambda: runtime kept current (no deprecated runtimes)
- [ ] Container images: scanned for vulnerabilities (if using ECS/EKS)
- [ ] No SSH/RDP access to production compute

---

## 5. Data Protection

### Encryption at Rest

- [ ] S3: SSE-S3 or SSE-KMS on all buckets
- [ ] RDS/Aurora: KMS encryption enabled
- [ ] EBS: encryption by default
- [ ] OpenSearch: node-to-node encryption + encryption at rest
- [ ] ElastiCache: encryption at rest + in transit
- [ ] Secrets Manager: for all credentials (DB, API keys, tokens)
- [ ] KMS key rotation: enabled for customer-managed keys

### Encryption in Transit

- [ ] TLS 1.2+ enforced everywhere
- [ ] ACM certificates for custom domains
- [ ] Internal service communication: VPC endpoints (no public internet)
- [ ] Database connections: SSL enforced

### Data Classification & Handling

- [ ] PII/PHI fields identified and documented
- [ ] PII not in URLs, logs, error messages, or query strings
- [ ] Data retention policies defined and automated (lifecycle rules)
- [ ] Data deletion: anonymization or hard delete per compliance
- [ ] Backup encryption: same or stronger than source
- [ ] Backup immutability: Vault Lock for ransomware protection

### S3 Bucket Security

- [ ] Block Public Access: enabled at account level
- [ ] Bucket policies: no public read/write
- [ ] Presigned URLs: short expiry (1-4 hours, not 24)
- [ ] Lifecycle policies: auto-delete temporary files
- [ ] Versioning: enabled on critical buckets
- [ ] Object Lock: for compliance-critical data

---

## 6. Application Security

### Input Validation

- [ ] API Gateway request validators enabled
- [ ] Lambda: validate all input (Zod, Joi, or equivalent)
- [ ] SQL injection prevention: parameterized queries only
- [ ] File upload validation: type, size, malware scan
- [ ] No user input passed directly to system commands

### API Security

- [ ] Authentication on all non-public endpoints
- [ ] Authorization checked at every layer (Gateway → Lambda → DB)
- [ ] Rate limiting per user/session
- [ ] CORS restricted to known origins
- [ ] API versioning strategy defined
- [ ] Error responses: no stack traces, no internal details

### CI/CD Security

- [ ] Dependency scanning: npm audit / Snyk in pipeline
- [ ] SAST: static analysis for security patterns
- [ ] Build-breaking policy: Critical/High findings block deploy
- [ ] Secret scanning: detect committed credentials (TruffleHog or equivalent)
- [ ] CDK Nag: security checks on infrastructure code
- [ ] No secrets in source code or environment variables

### AI/LLM Security (if applicable)

- [ ] Prompt injection defense: guardrails + limited tool access
- [ ] Rate limiting per session (not just per IP)
- [ ] Budget alarm on LLM spend (denial-of-wallet protection)
- [ ] Kill switch: disable AI component without affecting core app
- [ ] Hallucination guardrails: source-grounded responses only
- [ ] No PII in LLM training data or conversation logs
- [ ] Session isolation: no cross-user data leakage
- [ ] Blast radius analysis: what can a compromised AI component access?

---

## 7. Compliance Frameworks

### HIPAA (Health Data)

- [ ] BAA signed with AWS
- [ ] PHI encrypted at rest and in transit
- [ ] Access to PHI logged and auditable
- [ ] Minimum necessary access enforced
- [ ] Audit logs retained 6 years
- [ ] Automatic logoff ≤ 15 minutes for PHI-accessing terminals
- [ ] Backup and disaster recovery plan documented
- [ ] Breach notification procedures defined
- [ ] US-based personnel only for production PHI access (if required)

### SOC 2

- [ ] Access controls documented and enforced
- [ ] Change management process defined
- [ ] Monitoring and alerting in place
- [ ] Incident response plan documented
- [ ] Vendor management (third-party security)

### PCI-DSS (Payment Data)

- [ ] Cardholder data environment scoped
- [ ] Network segmentation enforced
- [ ] Encryption of cardholder data
- [ ] Access restricted to need-to-know
- [ ] Regular vulnerability scanning

### CCPA/CPRA (California Privacy)

- [ ] Right to know: can produce all data held about a person
- [ ] Right to delete: anonymization/deletion pipeline exists
- [ ] Right to opt-out: mechanism for data sharing opt-out
- [ ] 45-day response window for deletion requests
- [ ] Privacy policy published and accessible

---

## 8. Third-Party Security Assessment Review

### Delta Analysis Workflow

When a vCISO, pen test, or audit report is received:

1. Extract all findings with severity and recommendation
2. For each finding, search architecture docs for existing coverage
3. Classify: ✅ Addressed | ⚠️ Partial | ❌ Not addressed | ℹ️ Out of scope
4. Prioritize: Must fix before dev → Should fix → Defer/Accept
5. Estimate cost (AWS + dev effort) for each recommendation
6. Update architecture docs with fixes
7. Add unresolved items to stakeholder questionnaire
8. Track in a delta analysis document

### Common vCISO Findings Pattern

- IAM: MFA strength, token revocation, session management
- Data: encryption, backup immutability, log retention
- Network: WAF, rate limiting, VPC endpoints
- AI: prompt injection, rate limiting, kill switch, hallucination
- Compliance: HIPAA log retention, CCPA deletion pipeline

---

## 9. Public-Facing Attack Surface Analysis

### For Every Public Endpoint, Assess:

1. **Authentication:** Is it authenticated? If not, what's the blast radius?
2. **Rate limiting:** Per-IP, per-session, per-user?
3. **Input validation:** What can an attacker send?
4. **Data exposure:** What data can be extracted?
5. **Cost exposure:** Can an attacker drain budget? (denial of wallet)
6. **Injection:** Prompt injection (AI), SQL injection, XSS, SSRF?
7. **Session security:** Hijacking, fixation, cross-session leakage?
8. **Error handling:** Do errors leak internal details?
9. **CORS/origin:** Can unauthorized domains interact?
10. **Kill switch:** Can the component be disabled independently?

### Blast Radius Documentation

For each public component, document:

- What data it CAN access (read/write)
- What data it CANNOT access
- Worst case if fully compromised
