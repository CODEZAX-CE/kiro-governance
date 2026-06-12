# Security Gate 1.5 — Data Model Security Review

**Project:** `kiro_governance`
**Gate:** 1.5 — After Unified Data Model (Step 2.5a)
**Reviewer:** AWS Security Reviewer
**Date:** 2026-06-11
**Input documents:**
- `docs/phase1/architecture/unified-data-model.md` v1.0
- `docs/srs.md` v1.5

---

## Findings

| # | Severity | Area | Finding | Recommendation | Effort |
|---|----------|------|---------|----------------|--------|
| 1 | Medium | Encryption at Rest | DynamoDB uses **AWS-owned CMK** (default encryption). §2.1 documents this correctly, but provides no justification for why a customer-managed KMS key (CMK) was not chosen. For an audit log, key ownership matters — AWS-owned CMK means the customer cannot rotate, restrict, or revoke the key independently. | Document the explicit architect decision to accept AWS-owned CMK. If this is a conscious trade-off (POC cost vs key control), add a one-line rationale in §2.1: "Customer-managed KMS key deferred to production; not required for internal POC." If CMK is preferred, enable it — cost is ~$1/key/month. | Low |
| 2 | Medium | SSM Parameter Types | §3 marks `/kiro-governance/config/table-name` and `/kiro-governance/config/region` as `String`. These are not secrets, but storing them as `String` (plaintext) while secrets are stored as `SecureString` is correct. **However**, the data model does not document who has `ssm:GetParameter` permission for the `String` parameters vs the `SecureString` parameters. The Lambda/EC2 role needs `kms:Decrypt` to read `SecureString` values — this permission must be scoped to the specific KMS key used by SSM, not `kms:*`. | Add an IAM note to §3: the execution role must have `ssm:GetParameter` on `/kiro-governance/*` paths and `kms:Decrypt` scoped to the SSM-managed KMS key ARN only. Confirm the role does not have `kms:*`. | Low |
| 3 | Low | PII Inventory — `actor` field | §5 correctly flags `actor` as `Low–Medium` sensitive (may contain internal team member names). However, there is no stated retention or access control consequence for this. Since `actor` values persist indefinitely (no TTL), team member names/usernames will remain in the audit log forever. For internal tooling this is acceptable, but should be explicitly acknowledged as a deliberate decision — not a gap. | Add one sentence to §5 classification table: "Accepted: `actor` values (internal team member identifiers) persist indefinitely in the audit log. This is intentional — audit immutability requires preserving who acted." | Low |
| 4 | Low | Audit Trail Integrity | The append-only design (deletion protection + PITR + no TTL) is appropriate for a governance audit log. However, DynamoDB deletion protection prevents accidental table deletion but does **not** prevent an IAM principal with `dynamodb:DeleteItem` from deleting individual records. The data model does not state whether `DeleteItem` is denied on the execution role. | Add an explicit IAM constraint to §2.1 or a new §2.8: "Execution roles must NOT have `dynamodb:DeleteItem` or `dynamodb:UpdateItem` on the `kiro-governance-tracker` table. Only `PutItem`, `Query`, and `GetItem` are permitted." This closes the gap between table-level deletion protection and item-level immutability. | Low |
| 5 | Low | S3 Encryption — SSE-KMS vs SSE-S3 | §4 documents both S3 buckets use SSE-S3 (AES-256). This is correct for ephemeral Athena results. No finding on this choice per se, but the rationale is not stated. For internal tooling with no sensitive data in query results, SSE-S3 is adequate. | Add one-line rationale to §4: "SSE-S3 chosen over SSE-KMS — query results are ephemeral (7-day / 1-day lifecycle), contain no PII/PHI, and are internal only. KMS overhead not warranted." This prevents future reviewers from questioning the choice. | Low |
| 6 | Info | `update_text` Free-Text Content | §5 flags `update_text` as `Low–Medium` with the note "May contain project names, feature names, internal terminology." This is accurate. However, `update_text` is caller-supplied free text with a 4096-char limit. The data model does not specify any input sanitisation requirement. Since this is an internal tooling system, the blast radius of malformed content is low — but worth noting. | Not a blocker. Recommend that the architecture doc for FR-02 (MCP Server) documents input validation: `update_text` must be validated as a non-empty string with max 4096 chars before writing to DynamoDB. No further sanitisation needed for internal-only tooling. | Low |
| 7 | Info | Dedup Sentinel Record PII | DEDUP sentinel records (§2.7) contain `idempotency_key` in the format `rainn#SRS approved#2026-06-11`. The `pk` portion is a project name (GitHub repo name). This is not PII. Correctly excluded from PII inventory. No action needed. | No action required. | — |

---

## Review Area Summary

### 1. PII Inventory Accuracy
**✅ Accurate with minor gap.** §5 correctly identifies `actor` and `update_text` as the only fields with potential sensitivity. No customer PII, no PHI, no compliance framework required. Finding #3 requests one documentation clarification (deliberate retention decision for `actor`).

### 2. Encryption at Rest
**✅ Documented.** DynamoDB §2.1 and S3 §4 both document encryption settings. Finding #1 requests a rationale note for AWS-owned CMK. Finding #5 requests a rationale note for SSE-S3 on S3 buckets. Neither is a blocker.

### 3. IAM / Access Control
**⚠️ Gap.** The data model specifies role names (`kiro-gov-quicksight-athena-role`, `kiro-gov-athena-connector-role`) but does not specify IAM permission boundaries for the MCP server's execution role on DynamoDB. Specifically:
- `dynamodb:DeleteItem` and `dynamodb:UpdateItem` must be explicitly denied to preserve audit immutability (Finding #4).
- SSM `kms:Decrypt` scope must be documented (Finding #2).

### 4. SSM SecureString Usage
**✅ Correct.** All secrets (webhook URLs, MCP API key) are stored as `SecureString`. Non-secret config (table name, region) is stored as `String`. This is the correct pattern.

### 5. Data Retention
**✅ Appropriate.** DynamoDB audit log: indefinite (correct for governance audit). S3 Athena results: 7 days (correct for ephemeral query results). S3 spill bucket: 1 day (correct for transient Lambda overflow). SSM: indefinite with manual rotation (acceptable for config/secrets).

### 6. Audit Trail Integrity
**⚠️ Gap.** Append-only design is structurally sound (no TTL, deletion protection, PITR). However, item-level immutability is not enforced via IAM — the data model does not deny `DeleteItem`/`UpdateItem` on the execution role (Finding #4). This must be documented as an IAM constraint.

---

## Verdict

# CHANGES REQUIRED

**Blocking findings:** None (no Critical or High severity findings).

**Required before Step 3 (Technical Architecture Diagram):**

1. **Finding #4 (Medium→Low):** Add explicit IAM constraint denying `dynamodb:DeleteItem` and `dynamodb:UpdateItem` on the audit table. This is required to make the "append-only" claim verifiable — deletion protection alone is table-scoped, not item-scoped.
2. **Finding #2 (Medium):** Document the `kms:Decrypt` permission scope for the EC2/Lambda execution role reading SSM SecureString parameters.

**Non-blocking (documentation improvements):**

- Finding #1: Add rationale for AWS-owned CMK acceptance.
- Finding #3: Add one-sentence acknowledgement that `actor` name persistence is intentional.
- Finding #5: Add rationale for SSE-S3 on Athena buckets.
- Finding #6: Forward to MCP Server architecture doc — add input validation requirement for `update_text`.

> No compliance framework applies. No PHI/PII remediation required. The two medium findings are documentation/IAM-constraint gaps, not architecture failures. Once the architect adds the IAM constraint language to §2 and the SSM permission note to §3, this gate can be re-reviewed and approved.

---

*Security Gate 1.5 — kiro_governance — 2026-06-11*

---

## Final Pass — Security Gate 1.5

**Reviewer:** AWS Security Reviewer (security-gate-1.5-final)
**Date:** 2026-06-11
**Input documents reviewed:**
- `docs/phase1/architecture/unified-data-model.md` v1.1
- `docs/phase1/data-persistence-architecture.md` F-04 v1.4

---

### Fix Verification

| Finding | Fix Required | unified-data-model v1.1 | F-04 v1.4 | Status |
|---------|-------------|-------------------------|-----------|--------|
| MEDIUM-1 | AWS-owned CMK rationale in §2.1 | ✅ Present — explicit architect decision note with upgrade path | ✅ Present — both original note and security fix note in §2.1 | ✅ Fixed |
| MEDIUM-2 | `kms:Decrypt` scoped to `alias/aws/ssm` (not `*`) | ✅ Present in §3 — `"Resource": "arn:aws:kms:<region>:<account>:key/alias/aws/ssm"` with rationale note | ✅ Present in §6.1 IAM policy — `SSMKmsDecrypt` statement uses same scoped ARN | ✅ Fixed |
| LOW-4 | Explicit DENY on `dynamodb:DeleteItem` and `dynamodb:UpdateItem` | ⚠️ **DEFECT** — DENY block present but targets wrong resource ARN: `kiro-governance-events` instead of `kiro-governance-tracker` | ⚠️ **DEFECT** — `DenyAppendOnlyViolation` statement present but targets wrong resource ARN: `kiro-governance-events` instead of `kiro-governance-tracker` | ❌ Defective |
| LOW-5 | SSE-S3 rationale in both docs | ✅ Present in §4 — explicit rationale with upgrade path | ✅ Present in §5.2 — identical rationale | ✅ Fixed |

---

### New Issues Introduced

| # | Severity | Area | Finding |
|---|----------|------|---------|
| — | None | — | No new Critical or High findings introduced by v1.1 / v1.4 changes. |

---

### LOW-4 Defect — Details

The DENY statement for `dynamodb:DeleteItem` / `dynamodb:UpdateItem` targets the resource ARN `arn:aws:dynamodb:<region>:<account>:table/kiro-governance-events` in **both** documents. The actual table name throughout the entire architecture is `kiro-governance-tracker`.

**Impact:** A DENY statement pointing to a table that does not exist (`kiro-governance-events`) is effectively a **no-op at runtime**. The DENY never fires, meaning any IAM principal with a broader `Allow` could invoke `DeleteItem` or `UpdateItem` on `kiro-governance-tracker` without being blocked. The "append-only audit log" guarantee is not enforced.

**Required fix (both documents):**

```json
{
  "Sid": "DenyAppendOnlyViolation",
  "Effect": "Deny",
  "Action": ["dynamodb:DeleteItem", "dynamodb:UpdateItem"],
  "Resource": "arn:aws:dynamodb:<region>:<account>:table/kiro-governance-tracker"
}
```

Change `kiro-governance-events` → `kiro-governance-tracker` in both:
- `docs/phase1/architecture/unified-data-model.md` §2.1 DENY block
- `docs/phase1/data-persistence-architecture.md` §6.1 `DenyAppendOnlyViolation` statement

---

## Verdict

# CHANGES REQUIRED

**Blocking defect:**

**LOW-4 resource ARN mismatch** — The DENY statement in both `unified-data-model.md §2.1` and `data-persistence-architecture.md §6.1` targets `kiro-governance-events` instead of `kiro-governance-tracker`. This renders the append-only IAM enforcement inoperative. Fix the ARN in both documents, then re-verify.

**All other findings:** MEDIUM-1, MEDIUM-2, and LOW-5 are correctly and completely fixed. No new Critical or High issues were introduced.

**Action required:** Architect corrects both DENY resource ARNs (`kiro-governance-events` → `kiro-governance-tracker`), bumps both documents to their next patch version, and resubmits for a final approval check.

---

*Security Gate 1.5 Final Pass — kiro_governance — 2026-06-11*

---

## Round 3 — Approved

**Reviewer:** AWS Security Reviewer (Security Gate 1.5)
**Date:** 2026-06-11
**Documents reviewed:**
- `docs/phase1/architecture/unified-data-model.md` — v1.2
- `docs/phase1/data-persistence-architecture.md` — F-04 v1.5

### Single-Item Verification

| Check | Result |
|---|---|
| DENY statement resource ARN reads `kiro-governance-tracker` in `unified-data-model.md §2.1` | ✅ Confirmed |
| DENY statement resource ARN reads `kiro-governance-tracker` in `data-persistence-architecture.md §6.1` | ✅ Confirmed |
| ARN appears under `"Effect": "Deny"` with `dynamodb:DeleteItem` and `dynamodb:UpdateItem` actions in `unified-data-model.md` | ✅ Confirmed |
| ARN appears under `"Effect": "Deny"` (`Sid: DenyAppendOnlyViolation`) with `dynamodb:DeleteItem` and `dynamodb:UpdateItem` actions in `data-persistence-architecture.md` | ✅ Confirmed |

**LOW-4 defect:** Resolved. Both documents now correctly target the `kiro-governance-tracker` table, rendering the append-only IAM enforcement operative.

No new Critical or High findings identified.

---

## Verdict

# ✅ APPROVED

**Security Gate 1.5 is passed.** All Critical and High findings from Round 1 were resolved in Round 2. The sole blocking defect from Round 2 (LOW-4 — incorrect DENY resource ARN) is confirmed fixed in both documents. The kiro_governance data model and data persistence architecture are cleared to proceed to **Step 5: Technical Architecture Diagram**.

---

*Security Gate 1.5 Round 3 — kiro_governance — 2026-06-11*
