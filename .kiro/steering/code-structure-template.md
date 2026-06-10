# Code Structure & Development Standards Template

**Purpose:** Template for documenting a project's code structure, conventions, and development standards. Copy this file to your project's `docs/code-structure.md` and fill in the sections. This ensures every project has a consistent, implementation-ready code structure doc that developers and AI agents can reference.

**Usage:** Replace all `{placeholders}` and `<!-- FILL -->` comments with project-specific content. Delete sections that don't apply.

---

## 1. Repository Structure

<!-- Describe the repo layout: monorepo vs polyrepo, language, key directories -->
<!-- Example: "Monorepo — CDK infrastructure, backend Lambdas, and frontend in a single repository." -->

```
{project-name}/
├── infra/                              # IaC (CDK / CloudFormation / Terraform)
│   ├── bin/
│   │   └── app.ts                      # Entry point
│   ├── stacks/
│   │   ├── stateful.ts                 # Stateful resources (DB, storage, auth)
│   │   └── stateless.ts               # Stateless resources (API, compute, queues)
│   ├── constructs/                     # Reusable L3 constructs
│   └── config/
│       ├── dev.ts                      # Dev environment config
│       └── prod.ts                     # Prod environment config
│
├── packages/                           # Backend domain packages
│   ├── shared/                         # Shared across ALL domains
│   │   ├── types/                      # TypeScript interfaces (source of truth)
│   │   ├── middleware/                 # Auth, validation, error handling, audit
│   │   ├── db/                        # Connection pool, tenant context, query helpers
│   │   └── utils/                     # Secrets, date, validation, CSV helpers
│   │
│   ├── {domain-a}/                    # Domain: {description}
│   │   ├── infra.ts                   # CDK: Lambda defs + API routes for this domain
│   │   ├── handlers/                  # Lambda entry points
│   │   ├── services/                  # Business logic
│   │   └── types.ts                   # Domain-specific types (re-exports shared)
│   │
│   ├── {domain-b}/                    # Domain: {description}
│   │   └── ...
│   │
│   └── {domain-n}/                    # Domain: {description}
│       └── ...
│
├── frontend/                           # Frontend application
│   ├── src/
│   │   ├── app/                       # Routes / pages
│   │   ├── components/                # UI components
│   │   ├── hooks/                     # API hooks per domain
│   │   ├── lib/                       # Auth, API client, i18n
│   │   └── design-system/             # Tokens, primitives, layout
│   └── public/
│
├── specs/                              # OpenAPI specs, per-sprint spec docs
│   └── api/                           # OpenAPI YAMLs per domain
│
├── migrations/                         # SQL migrations (sequential)
│   └── V001__initial.sql
│
├── package.json                        # Root workspace config
├── tsconfig.base.json
└── cdk.json
```

---

## 2. Domain Boundaries

<!-- List each domain, what it owns, and what it depends on -->

Each domain is self-contained — handler code, business logic, types, AND CDK infrastructure live together.

### Co-Located Lambda Configuration

Each domain owns its Lambda definitions and API routes alongside its handler code. The central stateless stack is a thin orchestrator that composes domains.

```typescript
// packages/{domain}/infra.ts — domain owns its Lambda + route config
export class {Domain}Infra extends NestedStack {
  constructor(scope: Construct, id: string, props: DomainInfraProps & NestedStackProps) {
    super(scope, id, props);
    // Lambda definitions + API routes here
  }
}
```

```typescript
// infra/stacks/stateless.ts — thin orchestrator, one line per domain
export class StatelessStack extends Stack {
  constructor(scope: Construct, id: string, props: StatelessStackProps) {
    super(scope, id, props);
    const api = new RestApi(this, 'Api', { /* config */ });
    new {DomainA}Infra(this, '{DomainA}', { api, vpc, dbSecretArn });
    new {DomainB}Infra(this, '{DomainB}', { api, vpc, dbSecretArn });
    // ...
  }
}
```

### Domain Dependency Table

| Domain     | Owns                         | Depends On |
| ---------- | ---------------------------- | ---------- |
| shared     | Types, middleware, DB, utils | Nothing    |
| {domain-a} | <!-- FILL -->                | shared     |
| {domain-b} | <!-- FILL -->                | shared     |

**Rules:**

- Domains import from `shared/` — never from each other's `services/`
- Cross-domain data access goes through the database, not direct function calls
- If domain A needs data from domain B, it queries the DB table — not B's service layer

---

## 3. Lambda Handler Pattern

Every Lambda handler follows the same structure:

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { withMiddleware } from '@{project}/shared/middleware/rbac';
import { withTenantContext } from '@{project}/shared/db/rls-helpers';

/**
 * {Brief description}.
 * See specs/api/{domain}.yaml for API documentation.
 */
export const handler: APIGatewayProxyHandler = withMiddleware(
  {
    roles: [
      /* allowed roles */
    ],
  },
  async (event, context) => {
    const request = JSON.parse(event.body || '{}');
    const results = await withTenantContext(context.tenantId, () => serviceMethod(request));
    return { statusCode: 200, body: JSON.stringify(results) };
  },
);
```

**Key patterns:**

- `withMiddleware()` — extracts JWT, validates role, sets tenant context
- `withTenantContext()` — sets tenant ID on DB connection for RLS
- Handler is thin — delegates to service layer
- Types imported from `shared/types/`
- One-line JSDoc referencing the OpenAPI spec — nothing more

---

## 4. Shared Middleware Stack

Every API request passes through:

```
API Gateway (authorizer)
  → Lambda handler
    → withMiddleware()          # 1. Extract JWT claims
      → validateRole()          # 2. Check role permission
      → withTenantContext()     # 3. Set tenant ID on DB connection (RLS)
        → handler logic         # 4. Business logic
          → auditLog()          # 5. Log action
    → errorHandler()            # 6. Catch + format errors
```

---

## 5. Frontend Hook Pattern

Each domain has a hook that wraps API calls:

```typescript
import { useApiClient } from '@/lib/api-client';

export function use{Domain}() {
  const api = useApiClient();
  return {
    list: (query: string) => api.get<Item[]>(`/api/{domain}?q=${query}`),
    create: (data: CreateRequest) => api.post<{ id: string }>('/api/{domain}', data),
    getById: (id: string) => api.get<ItemDetail>(`/api/{domain}/${id}`),
  };
}
```

**Key patterns:**

- One hook per domain
- Hooks use shared `api-client.ts` which handles JWT injection, error handling, token refresh
- Types shared between frontend and backend via `@{project}/shared/types/`

---

## 6. Testing Structure

```
packages/{domain}/
  ├── __tests__/
  │   ├── handlers/           # Lambda handler tests (integration)
  │   ├── services/           # Service layer tests (unit)
  │   └── fixtures/           # Test data
frontend/
  └── __tests__/
infra/
  └── __tests__/              # CDK snapshot tests
```

---

## 7. Environment Configuration

```typescript
// infra/config/dev.ts
export const devConfig = {
  account: '{aws-account-id}',
  region: '{region}',
  // Service-specific config (sizing, capacity, etc.)
};
```

<!-- Document: how many environments, deployment model, CI/CD trigger -->

---

## 8. CDK Best Practices

### Stack Protection

- Stateful stack MUST have `terminationProtection: true` in prod
- Stateless stack does NOT need termination protection

### Removal Policies

| Resource       | Dev       | Prod                    |
| -------------- | --------- | ----------------------- |
| Database       | `DESTROY` | `RETAIN`                |
| S3 buckets     | `DESTROY` | `RETAIN`                |
| Search index   | `DESTROY` | `RETAIN`                |
| Auth (Cognito) | `DESTROY` | `RETAIN`                |
| Cache (Redis)  | `DESTROY` | `DESTROY` (rebuildable) |

### Log Retention

| Environment | Retention |
| ----------- | --------- |
| Dev         | 30 days   |
| Prod        | 90 days   |

### Resource Naming

Do NOT hardcode physical names on stateful resources. Let CDK generate names. Pass generated names/ARNs to Lambdas via environment variables.

### Deterministic Synthesis

- `cdk.context.json` MUST be committed to version control
- No AWS SDK calls during synthesis
- No CloudFormation Parameters or Conditions — all decisions at synthesis time

---

## 9. Error Handling Standard

All API errors follow a consistent shape:

```typescript
interface ApiError {
  statusCode: number;
  code: string; // Machine-readable: 'NOT_FOUND', 'VALIDATION_ERROR'
  message: string; // Human-readable
  details?: unknown; // Optional: field-level validation errors
}
```

| Status | When                                   |
| ------ | -------------------------------------- |
| 400    | Validation failed                      |
| 401    | JWT missing or expired                 |
| 403    | Permission denied                      |
| 404    | Resource not found                     |
| 409    | Conflict (duplicate, concurrent edit)  |
| 500    | Unexpected error (logged, not exposed) |

---

## 10. Naming Conventions

| Item                 | Convention                    | Example                   |
| -------------------- | ----------------------------- | ------------------------- |
| Lambda handler files | `{action}.ts`                 | `search.ts`, `create.ts`  |
| Service files        | `{noun}.service.ts`           | `order.service.ts`        |
| Type files           | `{domain}.ts` in shared/types | `order.ts`, `user.ts`     |
| CDK stacks           | `PascalCase`                  | `StatefulStack`           |
| CDK constructs       | `PascalCase`                  | `AppLambdaFunction`       |
| Domain infra         | `{Domain}Infra`               | `OrdersInfra`             |
| API routes           | `kebab-case`                  | `/api/orders/search`      |
| DB tables            | `snake_case`, plural          | `orders`, `order_items`   |
| DB columns           | `snake_case`                  | `created_at`, `is_active` |
| Migrations           | `V{NNN}__{description}.sql`   | `V001__initial.sql`       |
| Environment vars     | `UPPER_SNAKE_CASE`            | `DB_SECRET_ARN`           |
| OpenAPI spec files   | `{domain}.yaml`               | `orders.yaml`             |

---

## 11. Documentation Standards

Three-tier approach — no heavy JSDoc:

| Tier             | What                                                  | Where                         |
| ---------------- | ----------------------------------------------------- | ----------------------------- |
| OpenAPI spec     | API endpoints, request/response schemas, error codes  | `specs/api/{domain}.yaml`     |
| TypeScript types | Data structures, function signatures, inline comments | `packages/shared/types/`      |
| Lambda README    | Purpose, env vars, IAM permissions, deployment        | `packages/{domain}/README.md` |

**Rules:**

- Every Lambda handler gets a one-line JSDoc referencing its OpenAPI spec
- No `@param event`, `@returns` — TypeScript types handle this
- Complex business logic gets JSDoc explaining WHY, not WHAT
- OpenAPI specs are the single source of truth for API contracts

---

## 12. Traceability

<!-- Map key docs to their locations -->

| Source                 | Reference                      |
| ---------------------- | ------------------------------ |
| Lambda Function Groups | docs/technical-architecture.md |
| API Endpoints          | specs/api/                     |
| Data Model             | docs/data-model.md             |
| Sprint Planning        | docs/sprint-planning/          |

---

**This template is maintained in `.kiro/steering/code-structure-template.md`. Copy to `docs/code-structure.md` and customize per project.**
