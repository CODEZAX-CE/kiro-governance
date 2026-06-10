---
name: review-process
description: Code review workflow, output format, and severity levels. Use when conducting code reviews, reviewing PRs, or analyzing code changes.
metadata:
  version: '1.0'
---

## Review Workflow

1. Run `git diff --name-only` to see what files changed
2. Categorize changed files: backend (`packages/`), frontend (`frontend/`), infra (`infra/`), specs (`specs/`), migrations (`migrations/`)
3. For each file, use `code` tool to check diagnostics (TypeScript errors)
4. Read the file and apply the project review checklist (see `project-review-checklist` skill)
5. Use `find_references` to verify cross-domain imports aren't violating boundaries
6. Run `npx eslint` and `npx prettier --check` on changed files
7. Produce structured review output

## Output Format

```markdown
## Code Review: [branch name or description]

**Files reviewed:** X files across Y domains

### 🔴 Critical (Must Fix Before Merge)

- **packages/referrals/handlers/create.ts:25** — Missing `withTenantContext` wrapper
  - **Why:** RLS returns zero rows without tenant context — silent data loss
  - **Fix:** Wrap the DB query in `withTenantContext(context.countyId, () => ...)`

### 🟡 Should Fix

- **packages/clients/services/search.service.ts:42** — String interpolation in SQL query
  - **Why:** SQL injection risk
  - **Fix:** Use parameterized query with `$1` placeholder

### 🔵 Suggestions

- **packages/admin/handlers/users.ts:15** — Handler has 30 lines of business logic
  - **Why:** Handlers should be thin — delegate to service layer
  - **Fix:** Extract to `user.service.ts`

### 💬 Nits

- **packages/emc/types.ts:8** — Type name `data` is too generic
  - **Fix:** Rename to `EmcReportData`

### ✅ What's Good

- Proper use of `withMiddleware` with correct role array
- Zod validation on all request inputs
- OpenAPI spec updated alongside handler
```

## Severity Levels

| Level         | Meaning                                                 | Merge?                          |
| ------------- | ------------------------------------------------------- | ------------------------------- |
| 🔴 Critical   | Security vulnerability, data loss, broken functionality | Block                           |
| 🟡 Should Fix | Standards violation, missing tests, poor error handling | Fix before or immediately after |
| 🔵 Suggestion | Improvement opportunity, better pattern available       | Developer's judgment            |
| 💬 Nit        | Style, naming, minor readability                        | Optional                        |

## Gotchas

- Always check TypeScript diagnostics first — if the file has compile errors, deeper review is pointless.
- Don't just report problems. Acknowledge good patterns — it reinforces standards.
- When unsure if something is a bug or intentional, phrase it as a question: "Is this intentional? If so, add a comment explaining why."
- Review the OpenAPI spec change alongside the handler change — they must stay in sync.
