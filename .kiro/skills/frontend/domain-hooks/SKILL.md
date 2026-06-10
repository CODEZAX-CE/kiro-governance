---
name: domain-hooks
description: RTK Query and domain hook patterns for API data fetching in the project. Use when creating or modifying API slices, hooks like useClients, useReferrals, or any hook that calls the backend API.
metadata:
  version: '1.2'
---

## Two API Patterns — Choose the Right One

`lib/api-client.ts` exports two patterns:

| Pattern                             | When to use                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `baseQuery` + RTK Query `createApi` | Domain hooks that need caching, cache invalidation, loading/error state         |
| `useApiClient()` hook               | One-off calls that don't need caching (e.g. form submissions with custom logic) |

## RTK Query API Slice Pattern (preferred for domain hooks)

```typescript
// hooks/useClients.ts
import { createApi } from '@reduxjs/toolkit/query/react';
import { baseQuery } from '@/lib/api-client';
import { ClientSummary, CreateClientRequest } from '@[project]/shared/types/client';

export const clientsApi = createApi({
  reducerPath: 'clientsApi',
  baseQuery,
  tagTypes: ['Client'],
  endpoints: (builder) => ({
    searchClients: builder.query<ClientSummary[], string>({
      query: (q) => `/api/clients/search?q=${q}`,
      providesTags: ['Client'],
    }),
    createClient: builder.mutation<{ id: string }, CreateClientRequest>({
      query: (data) => ({ url: '/api/clients', method: 'POST', body: data }),
      invalidatesTags: ['Client'],
    }),
  }),
});

export const { useSearchClientsQuery, useCreateClientMutation } = clientsApi;
```

## useApiClient() Pattern (for direct calls)

```typescript
import { useApiClient } from '@/lib/api-client';

export function useSomeFeature() {
  const api = useApiClient();
  return {
    doSomething: (id: string) => api.get<Result>(`/api/something/${id}`),
  };
}
```

## Adding a New Endpoint to an Existing Slice

1. Check the OpenAPI spec at `specs/api/{domain}.yaml` for the endpoint contract
2. Import request/response types from `@[project]/shared/types/{domain}`
3. Add the endpoint to the existing `createApi` call
4. Configure `providesTags` / `invalidatesTags` for cache management
5. Export the auto-generated hook
6. Register the slice reducer and middleware in `store/index.ts`

## Gotchas

- `baseQuery` handles JWT injection, 401 redirect, and error formatting — don't wrap it further
- Types come from `@[project]/shared/types/` — coordinate with backend developer, don't create frontend-only API types
- One API slice per domain: `clientsApi`, `referralsApi`, etc. — no sub-slices
- Use `providesTags`/`invalidatesTags` for cache invalidation — don't manually refetch
- API paths follow `/api/{domain}/{action}` — check `specs/api/{domain}.yaml`, don't guess
