---
name: domain-infra
description: Co-located CDK infrastructure patterns for domain packages. Use when adding Lambda functions, API routes, SQS consumers, or wiring up new domain infrastructure in infra.ts files.
metadata:
  version: '2.0'
---

## Adding a New Endpoint to a Domain

1. Create the handler at `packages/{domain}/handlers/{action}.ts`
2. Open `packages/{domain}/infra.ts`
3. Add a `ProjectLambdaFunction` for the handler
4. Add a `ProjectApiRoute` wiring the Lambda to the API path + method + roles
5. If the Lambda needs new permissions, grant them in infra.ts (e.g., `table.grantReadData`)

## infra.ts Template

```typescript
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ProjectLambdaFunction } from '../../infra/constructs/lambda-function';
import { ProjectApiRoute } from '../../infra/constructs/api-route';

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

## StatelessStack Orchestrator

`infra/stacks/stateless.ts` composes all domains — one line each:

```typescript
new ClientsInfra(this, 'Clients', { api, vpc, dbSecretArn });
new ReferralsInfra(this, 'Referrals', { api, vpc, dbSecretArn, sqsQueues });
```

## Adding an SQS Consumer to a Domain

For domains that process async messages (notifications, OpenSearch indexer, SMS dispatch):

1. Create the handler at `packages/{domain}/handlers/{action}.ts` (use SQS consumer template from `lambda-handler-patterns`)
2. Open `packages/{domain}/infra.ts`
3. Add a `ProjectLambdaFunction` for the handler
4. Add a `SqsConsumer` wiring the Lambda to the SQS queue
5. Grant any additional IAM permissions (SES, OpenSearch, etc.)

```typescript
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ProjectLambdaFunction } from '../../infra/constructs/lambda-function';
import { SqsConsumer } from '../../infra/constructs/sqs-consumer';

export class NotificationsInfra extends NestedStack {
  constructor(scope: Construct, id: string, props: DomainInfraProps & NestedStackProps) {
    super(scope, id, props);

    const dispatcher = new ProjectLambdaFunction(this, 'Dispatcher', {
      entry: require.resolve('./handlers/dispatcher'),
      timeout: 30,
      environment: {
        DB_SECRET_ARN: props.dbSecretArn,
        IDEMPOTENCY_TABLE_NAME: props.idempotencyTableName,
      },
      vpc: props.vpc,
    });

    new SqsConsumer(this, 'NotificationConsumer', {
      queue: props.sqsQueues.notification,
      handler: dispatcher,
      batchSize: 10,
      reportBatchItemFailures: true, // CRITICAL — without this, one failure retries entire batch
    });

    // Grant permissions for what this consumer does
    props.sesIdentity.grantSendEmail(dispatcher.function);
  }
}
```

**Key differences from API route wiring:**

- No `ProjectApiRoute` — SQS triggers the Lambda, not API Gateway
- `reportBatchItemFailures: true` is mandatory — see `service-gotchas.md`
- Visibility timeout is set by the `SqsConsumer` construct (≥ 6× Lambda timeout)
- DLQ is wired automatically by the construct — CloudWatch alarm at depth > 0

## Gotchas

- You compose stacks using constructs — you do NOT create constructs. That's the construct-developer agent's job.
- Domain infra class naming: `{Domain}Infra` (e.g., `ClientsInfra`, `ReferralsInfra`).
- Each Lambda gets only the IAM permissions it needs — don't grant `*` access.
- Use `require.resolve('./handlers/search')` for the entry path — not a string literal.
- If you add a new domain, you must also add one line in `infra/stacks/stateless.ts`.
