---
name: lambda-handler-patterns
description: Lambda handler implementation patterns for all project handler types — REST API (withMiddleware + withTenantContext), WebSocket ($connect/$default/$disconnect), SQS consumer (batchItemFailures), and chatbot tool Lambdas (Zod + system account). Use when creating or modifying any Lambda handler.
metadata:
  version: '3.0'
---

## Creating a New Endpoint

1. Create handler file at `packages/{domain}/handlers/{action}.ts`
2. Import `withMiddleware` from `@[project]/shared/middleware/rbac`
3. Import `withTenantContext` from `@[project]/shared/db/rls-helpers`
4. Define the roles array for this endpoint
5. Parse and validate request body with Zod
6. Delegate to a service function — handler stays thin
7. Update `packages/{domain}/infra.ts` with new Lambda + API route
8. Update `specs/api/{domain}.yaml` with the endpoint spec

## Handler Template

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { withMiddleware } from '@[project]/shared/middleware/rbac';
import { withTenantContext } from '@[project]/shared/db/rls-helpers';
import { CreateClientSchema } from './schemas';
import { createClient } from '../services/client.service';

/** Create client. See specs/api/clients.yaml */
export const handler: APIGatewayProxyHandler = withMiddleware(
  { roles: ['root', 'county_admin', 'agency_admin', 'agency_staff'] },
  async (event, context) => {
    const input = CreateClientSchema.parse(JSON.parse(event.body || '{}'));
    const result = await withTenantContext(context.countyId, () => createClient(input));
    return { statusCode: 201, body: JSON.stringify(result) };
  },
);
```

## Zod Validation

```typescript
import { z } from 'zod';

const CreateClientSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
});
```

## Gotchas

- Always wrap business logic in `withTenantContext()` — even read queries. Without it, RLS returns zero rows.
- Never import services from another domain. If you need data from domain B, query the DB table directly.
- Handler must be thin — if it's more than ~15 lines of logic, extract to a service.
- One-line JSDoc referencing OpenAPI spec only. No `@param`/`@returns` — TypeScript types handle that.
- File naming is `{action}.ts` (e.g., `search.ts`, `create.ts`), not `{noun}.ts`.

## WebSocket Handler Template (chatbot only)

Three predefined routes: `$connect`, `$default`, `$disconnect`. Event type is `APIGatewayProxyEvent` but `requestContext` contains `connectionId`, `routeKey`, `eventType` instead of REST fields. No Cognito JWT — unauthenticated public endpoint.

```typescript
// packages/chatbot/handlers/ws-connect.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'chatbot-ws-connect' });

/** $connect: origin validation, kill switch check, connection init */
export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const origin = event.headers?.Origin || event.headers?.origin;

  // Origin whitelist check
  const allowed = process.env.ALLOWED_ORIGINS!.split(',');
  if (origin && !allowed.includes(origin)) {
    logger.warn('Rejected connection from unauthorized origin', { origin, connectionId });
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Kill switch check
  const enabled = await checkKillSwitch();
  if (!enabled) {
    return { statusCode: 403, body: 'Chatbot disabled' };
  }

  // Store connection metadata in Redis
  await connectionService.create(connectionId, { connectedAt: Date.now() });

  logger.info('Connection accepted', { connectionId });
  return { statusCode: 200, body: 'Connected' };
};
```

```typescript
// packages/chatbot/handlers/ws-message.ts
import { APIGatewayProxyHandler } from 'aws-lambda';

/** $default: rate limit, forward to AgentCore, stream response */
export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const body = JSON.parse(event.body || '{}');

  // Rate limit check (20 msgs/10 min via Redis)
  const allowed = await rateLimitService.check(connectionId);
  if (!allowed) {
    await postToConnection(connectionId, {
      error: 'Rate limit exceeded. Try again in a few minutes.',
    });
    return { statusCode: 429, body: 'Rate limited' };
  }

  // Forward to AgentCore — DO NOT log body (may contain PII)
  logger.info('Message received', { connectionId }); // no body content
  await forwardToAgentCore(connectionId, body);

  return { statusCode: 200, body: 'OK' };
};
```

**Key differences from REST handlers:**

- No `withMiddleware()` — unauthenticated, no JWT
- `connectionId` from `event.requestContext.connectionId` — used for `postToConnection()`
- Return `{ statusCode: 200 }` from `$connect` to accept the connection; non-200 rejects it
- Send data back via `ApiGatewayManagementApi.postToConnection()` — requires `execute-api:ManageConnections` IAM permission
- Never log `event.body` in `$default` — user messages may contain PII

## SQS Consumer Handler Template

For `notifications/dispatcher.ts`, `integration/indexer/opensearch-indexer.ts`, and `sms/handlers/dispatch.ts`. Event type is `SQSHandler`. Must enable `reportBatchItemFailures` to avoid retrying the entire batch when one message fails.

```typescript
// packages/notifications/handlers/dispatcher.ts
import { SQSHandler, SQSBatchResponse } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'notification-dispatcher' });
const metrics = new Metrics({ namespace: 'Project', serviceName: 'notification-dispatcher' });

/** SQS consumer — dispatches email/SMS notifications */
export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      await dispatchNotification(message);
      metrics.addMetric('NotificationSent', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to process message', {
        messageId: record.messageId,
        error: (error as Error).message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
      metrics.addMetric('NotificationFailed', MetricUnit.Count, 1);
    }
  }

  metrics.publishStoredMetrics();
  return { batchItemFailures };
};
```

**Key differences from REST handlers:**

- Return type is `SQSBatchResponse` with `batchItemFailures` — only failed messages are retried
- No `withMiddleware()` — SQS invokes directly, no JWT
- `withTenantContext()` still needed if querying tenant-scoped DB tables — extract `county_id` from message body
- `reportBatchItemFailures` must be enabled in CDK (`SqsConsumer` construct) — without it, one failure retries the entire batch
- Visibility timeout must be ≥ 6× Lambda timeout (see `service-gotchas.md`)

## Chatbot Tool Lambda Template

For `packages/chatbot/tools/`. Called by AgentCore Gateway, not API Gateway. Input is the tool call payload — no standard AWS event type. Uses Zod validation instead of `withMiddleware()`. Uses system service account for DB writes.

```typescript
// packages/chatbot/tools/search-services.ts
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { withTenantContext } from '@[project]/shared/db/rls-helpers';
import { auditLog } from '@[project]/shared/middleware/audit-logger';
import { SearchServicesInput } from './schemas';
import { searchPrograms } from '@[project]/shared/opensearch/search';

const logger = new Logger({ serviceName: 'chatbot-search-services' });
const metrics = new Metrics({ namespace: 'Project', serviceName: 'chatbot-search-services' });

/** Chatbot tool: search_services. Called by AgentCore Gateway. */
export const handler = async (event: unknown) => {
  // Zod validation replaces withMiddleware — no JWT to extract
  const input = SearchServicesInput.parse(event);

  const results = await withTenantContext(input.county_id, () =>
    searchPrograms({ countyId: input.county_id, searchText: input.search_text }),
  );

  // Audit: action + IDs only — never log user message content
  await auditLog({
    action: 'chatbot_search',
    county_id: input.county_id,
    result_count: results.length,
  });
  metrics.addMetric('ChatbotSearch', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();

  return results;
};
```

**Key differences from REST handlers:**

- No `withMiddleware()` — no JWT, no Cognito auth
- No `APIGatewayProxyHandler` type — event is raw tool call payload from AgentCore Gateway
- Zod schema validates input (AgentCore/LLM can send anything)
- System service account IDs from env vars for DB writes: `process.env.CHATBOT_SYSTEM_USER_ID`, `process.env.CHATBOT_AGENCY_ID` (see backend-standards.md §11.1)
- Audit logs: `action + county_id + entity IDs + result_count` only — never PII fields (see §12.6)
- `withTenantContext()` still required for RLS
