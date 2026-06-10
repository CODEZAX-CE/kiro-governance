# Lambda Documentation Standards

## Three-Tier Strategy

| Tier             | What                                                  | Where                         |
| ---------------- | ----------------------------------------------------- | ----------------------------- |
| OpenAPI spec     | API endpoints, request/response schemas, error codes  | `specs/api/{domain}.yaml`     |
| TypeScript types | Data structures, function signatures, inline comments | `packages/shared/types/`      |
| Lambda README    | Purpose, env vars, IAM permissions, deployment        | `packages/{domain}/README.md` |

---

## Handler Template

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { withMiddleware } from '@project/shared/middleware/rbac';

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
    const result = await serviceMethod(request);
    return { statusCode: 200, body: JSON.stringify(result) };
  },
);
```

---

## JSDoc Rules

- Every handler: one-line JSDoc referencing its OpenAPI spec — nothing more
- No `@param event`, `@returns Promise<...>` — TypeScript types handle this
- Complex business logic (algorithms, eligibility rules): JSDoc explaining WHY, not WHAT
- OpenAPI specs are the single source of truth for API contracts

---

## File Structure Per Domain

```
packages/{domain}/
├── README.md              # Purpose, env vars, IAM permissions
├── infra.ts               # CDK: Lambda defs + API routes
├── handlers/              # Lambda entry points (thin)
├── services/              # Business logic
├── types.ts               # Domain types (re-exports shared)
└── __tests__/             # Tests
specs/api/
└── {domain}.yaml          # OpenAPI spec
```

---

## Code Review Checklist

- [ ] TypeScript types defined in `shared/types/`
- [ ] OpenAPI spec updated in `specs/api/`
- [ ] README includes env vars
- [ ] No heavy JSDoc on handlers
- [ ] No hardcoded secrets

---

## Mandatory Requirements

1. **TypeScript** for all new Lambdas
2. **OpenAPI spec** for every API endpoint
3. **README.md** per domain with env vars and IAM permissions
4. **Minimal JSDoc** — only for complex business logic
