---
name: aurora-rls-patterns
description: Aurora Serverless v2 database patterns with Row-Level Security, tenant context, connection pooling, parameterized queries, and SQL migrations. Use when writing database queries, creating migrations, or working with multi-tenant data isolation.
metadata:
  version: '3.0'
---

## Writing a Tenant-Scoped Query

1. Always wrap queries in `withTenantContext(countyId, async () => { ... })`
2. Use parameterized queries with `$1`, `$2` placeholders — never string interpolation
3. RLS policies automatically filter by `county_id` — don't add `WHERE county_id = $X` manually
4. **Never skip `withTenantContext()`** — the fail-closed guard functions (`app.require_county_id()`, `app.require_user_role()`) throw exceptions if tenant context is not set. Every query requires it, including root user queries.

## Query Pattern (standard — county-scoped)

```typescript
const results = await withTenantContext(countyId, async () => {
  return db.query(
    'SELECT id, first_name, last_name FROM clients WHERE is_active = $1 ORDER BY created_at DESC LIMIT $2',
    [true, 50],
  );
});
```

## Cross-County Query Pattern (root user reports)

Root users see all rows across all counties. This is handled by PostgreSQL RLS dual-policy pattern — **not** by skipping tenant context.

Every table has two permissive policies (see `data-model.md` §12.2). PostgreSQL combines permissive policies with OR ([PostgreSQL docs](https://www.postgresql.org/docs/15/ddl-rowsecurity.html)), so a row is visible if **either** policy passes:

```sql
-- root_access: TRUE when role is root → sees all rows
CREATE POLICY root_access ON clients FOR ALL
  USING (app.require_user_role() = 'root');
-- county_isolation: TRUE when non-root AND county matches → scoped
CREATE POLICY county_isolation ON clients FOR ALL
  USING (app.require_user_role() != 'root'
    AND county_id = app.require_county_id());
-- Combined: root_access OR county_isolation
```

In application code, root users still call `withTenantContext()`:

```typescript
// Root user cross-county report — still uses withTenantContext
const results = await withTenantContext(user.countyId, async () => {
  return db.query(
    'SELECT r.id, r.status, c.name as county FROM referrals r JOIN counties c ON r.county_id = c.id WHERE r.created_at >= $1',
    [startDate],
  );
  // RLS: root_access policy → TRUE → all counties returned
});
```

## Creating a Migration

1. Find the next sequence number in `migrations/` (e.g., `V015__`)
2. Create file: `V{NNN}__{description}.sql`
3. Use `snake_case` for tables (plural) and columns
4. Include `county_id` column on every tenant-scoped table
5. Add RLS policy if the table contains tenant data

```sql
-- V015__client_notes.sql
CREATE TABLE client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  county_id UUID NOT NULL,
  note_text TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY county_isolation ON client_notes
  USING (county_id = current_setting('app.county_id')::UUID);
```

## Gotchas

- Without `withTenantContext()`, RLS returns zero rows — not an error, just empty results. This is the #1 silent bug.
- Never use string interpolation in queries. `db.query(\`... WHERE id = '${id}'\`)` is SQL injection.
- Connection pool is initialized outside the handler for Lambda reuse. Don't create new pools inside handlers.
- Migration files are immutable once deployed. To change a deployed migration, create a **compensating migration** (forward-fix):

```sql
-- Bad: V016__add_status.sql shipped with wrong type
-- ALTER TABLE referrals ADD COLUMN status VARCHAR(10);

-- Fix: V017__fix_status_length.sql (never edit V016)
ALTER TABLE referrals ALTER COLUMN status TYPE VARCHAR(20);
```

`node-pg-migrate` supports down migrations (`{name}.down.sql`), but this project uses **forward-only** by project decision (`E0-S06-migration-framework.md`). Down migrations risk data loss in production. Always create a new `V{N+1}__fix_{description}.sql` instead.

- `county_id` must be `UUID`, not `TEXT` — the RLS policy casts `current_setting()` to UUID.
