# Backend Development Standards

Standards for building serverless backend services on AWS Lambda with Aurora Serverless v2.

---

## 1. General Principles

- **Clarity over cleverness**: Readable code over clever abstractions
- **Explicit over implicit**: No magic — behavior should be obvious
- **Fail fast**: Errors are visible and actionable
- **Security by default**: Least privilege, encryption everywhere
- **Serverless-first**: Lambda, API Gateway, managed services — no containers
- **Domain ownership**: Each domain owns its handlers, services, types, AND infra

---

## 2. Technology Stack

| Layer         | Technology                                               |
| ------------- | -------------------------------------------------------- |
| Runtime       | Node.js LTS, TypeScript (strict mode)                    |
| Compute       | AWS Lambda                                               |
| API           | API Gateway (REST) with Cognito authorizer               |
| Database      | Aurora Serverless v2 (PostgreSQL)                        |
| Search        | OpenSearch Managed                                       |
| Cache         | ElastiCache Redis                                        |
| Auth          | Cognito (staff + client pools)                           |
| Async         | SQS, EventBridge, SES                                    |
| Storage       | S3, CloudFront                                           |
| IaC           | AWS CDK (TypeScript)                                     |
| Validation    | Zod                                                      |
| Observability | Lambda Powertools (Logger, Tracer, Metrics, Idempotency) |

**Not used**: Express.js, Fastify, NestJS, Docker, ECS, Kubernetes, MongoDB, RabbitMQ, Kafka.

---

## 3. Project Structure

Domain-based monorepo with co-located infrastructure. See `docs/code-structure.md` for the full tree.

```
[project]/
├── infra/                    # CDK infrastructure
│   ├── stacks/
│   │   ├── stateful.ts       # VPC, Aurora, ElastiCache, OpenSearch, S3, Cognito, Secrets Manager
│   │   └── stateless.ts      # API Gateway, WAF, all domain Lambdas, SQS, EventBridge, SES, CloudWatch
│   ├── constructs/           # ProjectLambdaFunction, ProjectApiRoute, SqsConsumer
│   └── config/               # dev.ts, prod.ts
├── packages/
│   ├── shared/               # Types, middleware, DB helpers, utils
│   ├── clients/              # Domain: handlers/, services/, infra.ts, types.ts
│   ├── referrals/            # Domain: handlers/, services/, matching/, infra.ts
│   ├── consent/              # Domain: handlers/, services/, infra.ts
│   ├── emc/                  # Domain: handlers/, services/, infra.ts
│   ├── programs/             # Domain: handlers/, services/, infra.ts
│   ├── admin/                # Domain: handlers/, services/, infra.ts
│   ├── sms/                  # Domain: handlers/, services/, infra.ts
│   ├── reporting/            # Domain: handlers/, services/, infra.ts
│   ├── integration/          # Domain: providers/, sync/, indexer/, infra.ts
│   └── notifications/        # Domain: handlers/, services/, templates/, infra.ts
├── specs/api/                # OpenAPI YAMLs per domain
├── migrations/               # Sequential SQL migrations (V001__, V002__, ...)
└── frontend/                 # Next.js (not your concern)
```

**Rules:**

- Each domain is self-contained: handlers + services + types + `infra.ts`
- Domains import from `shared/` — never from each other's `services/`
- Cross-domain data access goes through the database, not direct imports
- `infra/stacks/stateless.ts` is a thin orchestrator — one line per domain

---

## 4. Lambda Handler Pattern

Every handler follows this structure:

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { withMiddleware } from '@[project]/shared/middleware/rbac';
import { withTenantContext } from '@[project]/shared/db/rls-helpers';
import { SearchClientsRequest } from '@[project]/shared/types/client';
import { searchClients } from '../services/search.service';

/** Client search. See specs/api/clients.yaml */
export const handler: APIGatewayProxyHandler = withMiddleware(
  { roles: ['root', 'county_admin', 'agency_admin', 'agency_staff'] },
  async (event, context) => {
    const request: SearchClientsRequest = JSON.parse(event.body || '{}');
    const results = await withTenantContext(context.countyId, () => searchClients(request));
    return { statusCode: 200, body: JSON.stringify(results) };
  },
);
```

**Middleware stack** (every API request):

```
API Gateway (Cognito authorizer)
  → withMiddleware()        # Extract JWT, validate role
    → withTenantContext()   # Set county_id on DB connection (RLS)
      → handler logic       # Business logic
        → auditLog()        # Structured audit entry
  → errorHandler()          # Catch + format errors
```

**Rules:**

- Handlers are thin — delegate to service layer
- One-line JSDoc referencing OpenAPI spec — no `@param`/`@returns`
- Types from `shared/types/`, validated with Zod
- Complex business logic (matching, eligibility) gets JSDoc explaining WHY

---

## 5. Co-Located Infrastructure

Each domain owns its Lambda definitions and API routes. Domain infra classes extend `NestedStack` (not `Construct`) — each gets its own 500-resource CloudFormation budget and scoped rollback. See `cdk-stack-design-analysis.md` for rationale.

```typescript
// packages/clients/infra.ts
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';

export class ClientsInfra extends NestedStack {
  constructor(scope: Construct, id: string, props: DomainInfraProps & NestedStackProps) {
    super(scope, id, props);
    const search = new ProjectLambdaFunction(this, 'Search', {
      entry: require.resolve('./handlers/search'),
      memorySize: 256,
      timeout: 10,
      envVars: { DB_SECRET_ARN: props.dbSecretArn },
      vpc: props.vpc,
      environment: props.envName,
    });
    new ProjectApiRoute(this, 'SearchRoute', {
      api: props.api,
      method: 'GET',
      path: '/api/clients/search',
      handler: search,
      roles: ['root', 'county_admin', 'agency_admin', 'agency_staff'],
    });
  }
}
```

**You compose stacks using constructs — you do NOT create constructs** (that's the construct-developer agent's job).

---

## 6. Database Standards (Aurora Serverless v2)

- **Connection pooling**: Shared connection pool with tenant context
- **RLS**: Every query runs with `county_id` set via `withTenantContext()`
- **Secrets Manager**: DB credentials via Secrets Manager with 5-min cache
- **Parameterized queries**: Always — no string interpolation
- **Migrations**: Sequential SQL files (`V001__core_tables.sql`, `V002__extensions.sql`, ...)

```typescript
// Tenant-scoped query
const results = await withTenantContext(countyId, async () => {
  return db.query('SELECT * FROM clients WHERE is_active = true');
  // RLS policy automatically filters by county_id
});
```

**Naming:**

- Tables: `snake_case`, plural (`clients`, `referrals`, `program_cases`)
- Columns: `snake_case` (`county_id`, `created_at`, `is_active`)
- Migrations: `V{NNN}__{description}.sql`

---

## 6b. OpenSearch Standards

OpenSearch is used for program search (geo-distance, text relevance), referral dashboard aggregation, and chatbot RAG vectors. PostgreSQL is the system of record — OpenSearch is a read-optimized projection synced via SQS.

### Shared Client

Initialize outside the handler for connection reuse (same pattern as DB and Powertools):

```typescript
import { opensearchClient } from '@[project]/shared/opensearch/client';
```

The shared client in `packages/shared/opensearch/client.ts` handles connection setup, keep-alive, and VPC endpoint configuration. Do not create new clients inside handlers.

### Indexing (integration domain only)

Only `integration/indexer/opensearch-indexer.ts` writes to OpenSearch. All other domains read via `searchPrograms()`.

**Use the `_bulk` API** — never single-document index calls in batch operations. Per [AWS OpenSearch Best Practices](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html), target 3-5 MiB per bulk request. For this project's scale (~hundreds to low thousands of programs per county at ~2-5 KB each), one bulk call per county sync is sufficient.

**Handle partial failures** — the `_bulk` API can return `errors: true` with per-item success/failure. Check it:

```typescript
const response = await opensearchClient.bulk({ body: bulkBody });

if (response.body.errors) {
  const failed = response.body.items.filter((item: any) => item.index?.error || item.update?.error);
  logger.error('Partial bulk index failure', {
    failedCount: failed.length,
    totalCount: response.body.items.length,
    errors: failed.map((f: any) => f.index?.error || f.update?.error),
  });
  metrics.addMetric('OpenSearchIndexFailure', MetricUnit.Count, failed.length);
  // Failed items stay in SQS (message not deleted) → retried automatically
}
```

**Idempotency is built-in** — OpenSearch `index` and `update` operations are upserts when you specify `_id`. If SQS delivers the same message twice, the document is re-indexed with the same content. No Powertools Idempotency needed for the indexer — it's naturally idempotent.

**DLQ alarm** — the `opensearch-sync-queue` has a DLQ. CloudWatch alarm fires on DLQ depth > 0. Any message in the DLQ means a program exists in PostgreSQL but is missing from search results.

### Querying (all domains)

Queries go through `searchPrograms()` in `packages/referrals/matching/`. The shared function handles:

- Multi-field text search (program_name, description, eligibility_text, taxonomy labels — EN + ES)
- Geo-distance sorting via `geo_point` fields
- Partner boost scoring
- County scoping via `withTenantContext()`

If OpenSearch is unavailable, return 503 `SEARCH_UNAVAILABLE` — do not return empty results silently. See edge-case-gap-tracker MATCH-5.

---

## 6c. SQS Message Publishing Standards

This project uses SQS as its async event bus. Multiple domains publish messages to shared queues; the notification dispatcher and OpenSearch indexer consume them. All messages must follow a consistent shape.

### Standard Message Shape

```typescript
interface SqsMessageBody {
  type: string; // Machine-readable event type
  referral_id?: string;
  client_id?: string;
  county_id: string; // Always include — consumer may need it for routing/logging
  program_id?: string;
  timestamp: string; // ISO 8601
  source: string; // Publishing domain: 'referrals' | 'chatbot' | 'surveys' | 'integration' | 'sms'
}
```

### Known Message Types

| Type                      | Publisher                               | Queue           | Consumer                                    |
| ------------------------- | --------------------------------------- | --------------- | ------------------------------------------- |
| `referral_created`        | `referrals/handlers/create.ts`          | notification    | `notifications/dispatcher.ts`               |
| `referral_status_changed` | `referrals/handlers/status.ts`          | notification    | `notifications/dispatcher.ts`               |
| `chatbot_referral`        | `chatbot/tools/create-self-referral.ts` | notification    | `notifications/dispatcher.ts`               |
| `survey_referral_created` | `programs/handlers/survey-submit.ts`    | notification    | `notifications/dispatcher.ts`               |
| `program_updated`         | `integration/sync/sync-handler.ts`      | opensearch-sync | `integration/indexer/opensearch-indexer.ts` |
| `sms_send`                | `sms/services/campaign.service.ts`      | sms-dispatch    | `sms/handlers/dispatch.ts`                  |

### Publishing Pattern

```typescript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({}); // initialized outside handler

await sqsClient.send(
  new SendMessageCommand({
    QueueUrl: process.env.NOTIFICATION_QUEUE_URL!,
    MessageBody: JSON.stringify({
      type: 'referral_created',
      referral_id: referral.id,
      county_id: input.county_id,
      timestamp: new Date().toISOString(),
      source: 'referrals',
    }),
  }),
);
```

### Error Handling

- Wrap `sendMessage` in try/catch. If SQS is unreachable, the primary operation (e.g., referral creation) has already committed to the DB — log the error and let the DLQ alarm catch it.
- Do NOT fail the API response because of a notification queue failure. The referral is created; the notification is best-effort.
- Log: `logger.error('Failed to publish to SQS', { queue: 'notification', type: 'referral_created', referralId })`.
- Emit metric: `metrics.addMetric('SqsPublishFailure', MetricUnit.Count, 1)`.

### Queues

| Queue                   | Purpose                                            | DLQ | Alarm         |
| ----------------------- | -------------------------------------------------- | --- | ------------- |
| `notification-queue`    | Email/SMS dispatch for referrals, consent, chatbot | Yes | DLQ depth > 0 |
| `opensearch-sync-queue` | Program/referral index updates                     | Yes | DLQ depth > 0 |
| `sms-dispatch-queue`    | Per-recipient SMS sends for campaigns              | Yes | DLQ depth > 0 |

All queues have DLQs with `maxReceiveCount: 3`. CloudWatch alarm on every DLQ at depth > 0 — any message in a DLQ means something is broken.

---

## 7. Naming Conventions

| Item                | Convention                       | Example                           |
| ------------------- | -------------------------------- | --------------------------------- |
| Handler files       | `{action}.ts`                    | `search.ts`, `create.ts`          |
| Service files       | `{noun}.service.ts`              | `referral.service.ts`             |
| Type files          | `{domain}.ts` in `shared/types/` | `client.ts`, `referral.ts`        |
| CDK stacks          | `PascalCase`                     | `StatefulStack`, `StatelessStack` |
| Domain infra        | `{Domain}Infra`                  | `ClientsInfra`, `ReferralsInfra`  |
| API routes          | `kebab-case`                     | `/api/clients/search`             |
| Environment vars    | `UPPER_SNAKE_CASE`               | `DB_SECRET_ARN`                   |
| OpenAPI specs       | `{domain}.yaml`                  | `clients.yaml`                    |
| Files               | `kebab-case.ts`                  | `search.service.ts`               |
| Classes             | `PascalCase`                     | `UserService`                     |
| Functions/Variables | `camelCase`                      | `getUserById`                     |
| Constants           | `UPPER_SNAKE_CASE`               | `MAX_RETRY_ATTEMPTS`              |

---

## 8. TypeScript Standards

Strict mode required:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  }
}
```

- No `any` — use `unknown` if type is truly unknown
- Explicit return types on exported functions
- `readonly` for immutable data
- Discriminated unions for complex types
- Zod schemas for runtime validation at API boundaries

---

## 9. API Design

- **Resources**: Nouns, not verbs (`/api/clients`, not `/api/getClients`)
- **Methods**: GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove)
- **Pagination**: `limit` + `cursor` for large datasets
- **Validation**: Zod at handler level, API Gateway request models where practical
- **Versioning**: Not needed yet — single API version

---

## 10. Error Handling

All errors follow the project's `ApiError` shape:

```typescript
interface ApiError {
  statusCode: number;
  code: string; // Machine-readable: 'CLIENT_NOT_FOUND'
  message: string; // Human-readable: 'Client not found'
  details?: unknown; // Optional: validation errors
}
```

| Status | When                                     |
| ------ | ---------------------------------------- |
| 400    | Validation failed                        |
| 401    | JWT missing or expired                   |
| 403    | Role/county/agency permission denied     |
| 404    | Resource not found                       |
| 409    | Conflict (duplicate, concurrent edit)    |
| 500    | Unexpected error (logged, never exposed) |

Custom error classes:

```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id ${id} not found`, 404);
  }
}
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}
```

---

## 11. Security

- **Cognito**: Staff pool + client portal pool, JWT authorizer on API Gateway
- **RBAC**: `withMiddleware({ roles: [...] })` on every handler
- **RLS**: `county_id` set on every DB connection — data isolation by tenant
- **Secrets Manager**: All credentials, cached 5 minutes
- **IAM least privilege**: Each Lambda gets only the permissions it needs
- **Parameterized queries**: Always — no SQL injection
- **No secrets in code**: Environment variables for ARNs, Secrets Manager for credentials
- **Encryption**: At rest (Aurora, S3, OpenSearch) and in transit (TLS 1.2+)

### 11.1 System Service Accounts

Unauthenticated flows (chatbot, future client portal self-service) create records in tables with NOT NULL FK columns (`created_by`, `captured_by`, `from_user_id` → `users(id)`). These flows use system service accounts — `users` rows with `role='system'` that exist only in PostgreSQL, never in Cognito.

**Current service accounts** (seeded by migration `V015__chatbot_seed.sql`):

| Account               | UUID                                   | Purpose                                                                                         |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CHATBOT_SYSTEM_USER` | `00000000-0000-0000-0000-000000000001` | `created_by`, `captured_by`, `from_user_id` FK for chatbot-created clients, consents, referrals |
| `CHATBOT_AGENCY`      | `00000000-0000-0000-0000-000000000002` | `from_agency_id` FK for chatbot referrals; appears in outbox                                    |

**How to reference them:**

```typescript
// Always from environment variables — never hardcode UUIDs
const CHATBOT_SYSTEM_USER_ID = process.env.CHATBOT_SYSTEM_USER_ID!;
const CHATBOT_AGENCY_ID = process.env.CHATBOT_AGENCY_ID!;
```

Env vars are injected by CDK from SSM Parameters (see `chatbot-technical-architecture.md` §4.1.3).

**Security hardening — mandatory guards:**

| Guard                      | Where to implement                         | Code                                                      |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Excluded from user listing | `packages/admin/handlers/users.ts`         | `WHERE role != 'system'`                                  |
| Impersonation blocked      | `packages/admin/handlers/impersonation.ts` | `if (targetUser.role === 'system') return 403`            |
| No Cognito account         | Seed data only — no `AdminCreateUser` call | JWT can never be issued for this UUID                     |
| RBAC bypass                | `packages/shared/middleware/rbac.ts`       | `userMatchesPolicy()` returns `false` for `role='system'` |

If you add a new system service account in the future, apply all four guards.

---

## 12. Logging & Observability

All Lambdas use [Powertools for AWS Lambda (TypeScript)](https://docs.aws.amazon.com/powertools/typescript/latest/). Initialize all utilities **outside** the handler for Lambda execution environment reuse.

### 12.1 Standard Initialization

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// Instantiate OUTSIDE handler — reused across warm invocations
const logger = new Logger({ serviceName: 'client-service' });
const tracer = new Tracer({ serviceName: 'client-service' });
const metrics = new Metrics({ namespace: 'Project', serviceName: 'client-service' });
```

**Cold start mitigation:** Node.js Lambda cold starts are typically 200-500ms. This project already applies the most impactful mitigations:

- ARM64 (Graviton) — default in `ProjectLambdaFunction` construct, 15-40% faster init than x86
- SDK clients + Powertools initialized outside handler — reused across warm invocations
- Small bundle size — domain-scoped Lambdas, not monolithic

**Provisioned concurrency** is NOT used. It eliminates cold starts but costs ~$0.0000041667/GB-second even when idle. For a cost-conscious nonprofit, this is not justified — Node.js cold starts are well within the 3-second API response target. If a specific Lambda (e.g., referral creation) shows p99 latency issues in production, provisioned concurrency can be added per-Lambda in `infra.ts` without architecture changes. SnapStart is not available for Node.js.

### 12.2 Logger

Structured JSON logging. CloudWatch parses it automatically.

```typescript
logger.info('Client created', { clientId: client.id, countyId });
logger.error('Failed to create client', { error: error.message });
```

- Log levels: ERROR, WARN, INFO, DEBUG (DEBUG only in dev)
- Never log PII, passwords, tokens, or secrets
- Set via env var `POWERTOOLS_LOG_LEVEL` or constructor

### 12.3 Tracer

Application-level X-Ray instrumentation. Auto-captures AWS SDK calls and HTTP requests. CDK enables X-Ray at infra level (`tracing: lambda.Tracing.ACTIVE`); Tracer adds subsegments inside your code.

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('## searchClients');
  try {
    const results = await searchClients(request);
    subsegment?.close();
    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    subsegment?.addError(err as Error);
    subsegment?.close();
    throw err;
  }
};
```

- `tracer.captureAWSv3Client(client)` — wraps any AWS SDK v3 client for automatic subsegments
- `tracer.annotateColdStart()` — adds cold start annotation to traces
- Do NOT use raw `aws-xray-sdk` — use Powertools Tracer

### 12.4 Metrics

Custom CloudWatch metrics via Embedded Metric Format (EMF). Zero latency — metrics are embedded in log lines, CloudWatch extracts them asynchronously. No `PutMetricData` API calls.

```typescript
// In handler or service
metrics.addMetric('ReferralCreated', MetricUnit.Count, 1);
metrics.addDimension('county', countyId);

// Flush at end of handler (or use metrics.publishStoredMetrics() manually)
```

**Environment variables** (set in `ProjectLambdaFunction` construct):

- `POWERTOOLS_METRICS_NAMESPACE` = `Project`
- `POWERTOOLS_SERVICE_NAME` = `{domain}-service`

**When to emit custom metrics:**

- Chatbot security alarms: `ChatbotReferralCreated`, `CountyNotSupported`, `RateLimitHit`, `BedrockError` (see `chatbot-technical-architecture.md` §4.1.3)
- Business metrics: `ReferralCreated`, `ClientCreated`, `ConsentCaptured`
- Error tracking: `ValidationError`, `NotFoundError` per domain

### 12.5 Idempotency

Prevents duplicate processing when SQS delivers the same message twice (at-least-once delivery) or when a user double-clicks a submit button. Uses DynamoDB as persistence layer.

```typescript
import { makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME!,
});

const processRecord = makeIdempotent(
  async (record: SQSRecord) => {
    const body = JSON.parse(record.body);
    await sendNotification(body);
  },
  { persistenceStore },
);
```

**When to use idempotency:**

| Lambda                                  | Why                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| `notifications/handlers/dispatcher.ts`  | SQS consumer — duplicate delivery = duplicate email/SMS |
| `integration/sync/sync-handler.ts`      | EventBridge trigger — duplicate = redundant iCarol sync |
| `chatbot/tools/create-self-referral.ts` | Double-click on consent button = duplicate referral     |
| Any POST endpoint that creates records  | Retry from frontend or API Gateway = duplicate record   |

**DynamoDB table** for idempotency records: created in `StatefulStack`, passed to Lambdas via `IDEMPOTENCY_TABLE_NAME` env var. Table has TTL enabled — records auto-expire (default 1 hour).

**IAM**: Lambda needs `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem` on the idempotency table.

### 12.6 General Rules

- **CloudWatch alarms** for error rates, duration p99, throttles
- **Audit logging** via `auditLog()` middleware for compliance-sensitive actions
- Never log PII, passwords, tokens, or secrets
- Chatbot tool Lambdas: log `action + tenant_id + result_count` only — never user message content

---

## 13. Testing

- **Unit tests (70%)**: Service layer logic in isolation
- **Integration tests (20%)**: Handler tests with mocked AWS services
- **E2E tests (10%)**: Critical user flows against deployed stack
- **Minimum 80% coverage** for business logic
- **100% coverage** for auth, consent, and payment paths

```
packages/{domain}/
  ├── __tests__/
  │   ├── handlers/     # Integration tests
  │   ├── services/     # Unit tests
  │   └── fixtures/     # Test data
```

Mock AWS services with `aws-sdk-client-mock`. Use fixtures for test data.

---

## 14. Lambda Documentation (Three-Tier)

Per `.kiro/steering/lambda-docs.md`:

| Tier             | What                                 | Where                         |
| ---------------- | ------------------------------------ | ----------------------------- |
| OpenAPI spec     | Endpoints, schemas, errors           | `specs/api/{domain}.yaml`     |
| TypeScript types | Data structures, function signatures | `packages/shared/types/`      |
| Lambda README    | Purpose, env vars, IAM, testing      | `packages/{domain}/README.md` |

**No heavy JSDoc on handlers.** One-line referencing the OpenAPI spec. TypeScript types ARE the documentation.

---

## 15. Code Quality (Mandatory)

- **Prettier** + **ESLint** — enforced in CI
- **Husky + lint-staged** — pre-commit hooks
- Pipeline fails if `format:check` or `lint:check` fails
- No exceptions

---

## 16. Definition of Done

- [ ] Handler follows `withMiddleware` + `withTenantContext` pattern
- [ ] TypeScript strict mode, no `any`
- [ ] Zod validation on request input
- [ ] Types in `shared/types/`
- [ ] OpenAPI spec updated in `specs/api/`
- [ ] Domain `README.md` has env vars and IAM permissions
- [ ] Error handling uses `AppError` classes
- [ ] Unit tests passing (>80% coverage)
- [ ] Formatted with Prettier, passes ESLint
- [ ] Co-located `infra.ts` updated if new Lambda/route
- [ ] No hardcoded secrets
- [ ] Audit logging for sensitive operations
- [ ] Chatbot tool Lambdas: audit logs contain `action + county_id + entity IDs + result_count` only — no user message content, no PII fields (name, phone, email). See §12.6
