---
name: testing-patterns
description: Unit and integration test patterns for Lambda handlers and services. Use when writing tests, mocking middleware, or testing multi-tenant data isolation.
metadata:
  version: '1.1'
---

## Writing a Service Unit Test

1. Create test at `packages/{domain}/__tests__/services/{service}.test.ts`
2. Mock the DB connection — don't hit real Aurora
3. Mock `withTenantContext` to just execute the callback directly
4. Test business logic in isolation
5. Use fixtures from `__tests__/fixtures/` for test data

```typescript
import { searchClients } from '../../services/search.service';

jest.mock('@[project]/shared/db/rls-helpers', () => ({
  withTenantContext: (_countyId: string, fn: () => any) => fn(),
}));

jest.mock('@[project]/shared/db/connection', () => ({
  getConnection: () => ({
    query: jest.fn().mockResolvedValue({ rows: [{ id: '1', first_name: 'Jane' }] }),
  }),
}));

describe('searchClients', () => {
  it('returns matching clients', async () => {
    const results = await searchClients({ query: 'Jane' });
    expect(results).toHaveLength(1);
    expect(results[0].first_name).toBe('Jane');
  });
});
```

## Writing a Handler Integration Test

1. Create test at `packages/{domain}/__tests__/handlers/{action}.test.ts`
2. Mock AWS services with `aws-sdk-client-mock`
3. Build a fake API Gateway event
4. Call the handler directly
5. Assert on statusCode and parsed body

```typescript
import { handler } from '../../handlers/create';
import { mockClient } from 'aws-sdk-client-mock';

const event = {
  body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  requestContext: {
    authorizer: {
      claims: { sub: 'user-1', 'custom:county_id': 'county-1', 'custom:role': 'agency_staff' },
    },
  },
} as any;

it('returns 201 on valid input', async () => {
  const result = await handler(event, {} as any, () => {});
  expect(result.statusCode).toBe(201);
});
```

## Coverage Requirements

| Path                     | Minimum |
| ------------------------ | ------- |
| Auth, consent, payment   | 100%    |
| All other business logic | 80%     |

## Gotchas

- Always mock `withTenantContext` in unit tests — it sets `app.county_id` on a real DB connection, which doesn't exist in test.
- Use `aws-sdk-client-mock`, not `jest.mock('aws-sdk')`. The project uses AWS SDK v3.
- Test fixtures go in `packages/{domain}/__tests__/fixtures/`, not inline in test files.
- For RLS isolation tests, call the service twice with different `countyId` values and verify results don't leak across tenants.
- Don't test handler middleware logic in service tests — that's an integration test concern.

## Mocking OpenSearch

For services that query OpenSearch (`referrals/matching/`, `chatbot/tools/`), mock the shared client:

```typescript
jest.mock('@[project]/shared/opensearch/client', () => ({
  opensearchClient: {
    search: jest.fn().mockResolvedValue({
      body: {
        hits: {
          total: { value: 2 },
          hits: [
            { _source: { program_id: '1', program_name: 'Food Bank', distance_miles: 2.3 } },
            { _source: { program_id: '2', program_name: 'Shelter', distance_miles: 5.1 } },
          ],
        },
      },
    }),
    bulk: jest.fn().mockResolvedValue({ body: { errors: false, items: [] } }),
  },
}));
```

- Mock `search` for query tests (matching, chatbot search-services)
- Mock `bulk` for indexer tests — test both `errors: false` (success) and `errors: true` (partial failure) paths
- Never hit a real OpenSearch cluster in unit tests
