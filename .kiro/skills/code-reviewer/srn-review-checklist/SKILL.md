---
name: project-review-checklist
description: Project-specific code review checklist for backend and frontend. Use when reviewing Lambda handlers, services, components, infra, or migrations.
metadata:
  version: '1.0'
---

## Backend Review Checklist

### Handler Review

- [ ] Uses `withMiddleware({ roles: [...] })` with correct role array
- [ ] Uses `withTenantContext(context.countyId, () => ...)` for all DB queries
- [ ] Handler is thin — delegates to service layer (max ~15 lines of logic)
- [ ] Request body parsed and validated with Zod schema
- [ ] One-line JSDoc referencing OpenAPI spec — no heavy JSDoc
- [ ] File named `{action}.ts` (e.g., `search.ts`, `create.ts`)

### Service Review

- [ ] No imports from other domains' `services/` — only from `shared/`
- [ ] Parameterized queries only — no string interpolation in SQL
- [ ] Errors thrown as `AppError` subclasses with machine-readable codes
- [ ] No PII in log statements

### Types & Validation

- [ ] Types defined in `packages/shared/types/{domain}.ts`
- [ ] Zod schemas match TypeScript interfaces
- [ ] No `any` types — `unknown` if truly unknown

### Infrastructure (infra.ts)

- [ ] New Lambda uses `ProjectLambdaFunction` construct
- [ ] New route uses `ProjectApiRoute` construct with correct roles
- [ ] IAM permissions are least-privilege (no `*` grants)
- [ ] `infra/stacks/stateless.ts` updated if new domain added

### Documentation

- [ ] OpenAPI spec updated in `specs/api/{domain}.yaml`
- [ ] Domain `README.md` has env vars and IAM permissions
- [ ] Types serve as code documentation — no redundant JSDoc

### Database

- [ ] New tables have `county_id` column and RLS policy
- [ ] Migration file follows `V{NNN}__{description}.sql` naming
- [ ] Migration is additive — no destructive changes to deployed migrations

## Frontend Review Checklist

### Component Review

- [ ] Client components use `'use client'` directive
- [ ] Uses MUI components with design system theme
- [ ] Error boundaries on critical features
- [ ] Loading, error, and empty states handled
- [ ] Accessible: semantic HTML, ARIA labels, keyboard navigation

### Data & State

- [ ] API calls go through domain hooks (`useClients`, `useReferrals`, etc.)
- [ ] Types imported from `@[project]/shared/types/`
- [ ] No raw `fetch` calls — uses `api-client.ts` wrapper

### i18n

- [ ] User-facing strings use translation keys, not hardcoded English
- [ ] Translation keys added to both `en.json` and `es.json`

## Security Review (Both)

- [ ] No hardcoded secrets, API keys, or credentials
- [ ] Consent checked before displaying PII across agencies
- [ ] PHI obfuscation applied for health taxonomy referrals
- [ ] Program-scoped permissions enforced (CalWORKs = root-only)
- [ ] Impersonation actions are audit-logged
- [ ] Input validation on all API boundaries

## Gotchas

- `withTenantContext` missing = silent empty results, not an error. This is the #1 bug to catch.
- Cross-domain service imports are the #2 most common violation. Use `find_references` to verify.
- Handlers that grow beyond ~15 lines of logic always need extraction to a service.
- New endpoints without OpenAPI spec updates break the three-tier documentation contract.
- Frontend components without error boundaries will crash the entire page on failure.
- Missing `es.json` translation keys will show raw keys to Spanish-speaking users.
