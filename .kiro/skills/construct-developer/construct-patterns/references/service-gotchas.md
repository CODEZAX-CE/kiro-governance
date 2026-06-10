# Service-Specific Gotchas

Gotchas for specific AWS services used in constructs. Agent: read this when working with a specific service construct.

## SQS Consumer

- Visibility timeout must be >= 6x Lambda timeout. If Lambda timeout is 30s, visibility timeout must be >= 180s. CDK won't warn you — messages reappear and get processed twice.
- Always enable `reportBatchItemFailures` — without it, one failed message retries the entire batch.
- DLQ alarm threshold should be 1 (any message = something is broken).
- FIFO queues need `fifo: true` and `contentBasedDeduplication: true` — different props path than standard queues.

## API Route

- The `roles` array is passed as a Lambda environment variable — consumed by `withMiddleware()` at runtime, not enforced at CDK level.
- API paths must start with `/api/`.
- The Cognito authorizer is shared across all routes — don't create a new one per route.
- CORS preflight is configured at the API level in `infra/stacks/stateless.ts`, not per route.

## Lambda Function

- VPC placement is optional — not all Lambdas need database access (e.g., notification dispatcher).
- Lambda layers are shared across all functions. Updating a layer affects all functions on next deploy.
- ARM64 (Graviton) is the default — 20% cost savings. Only switch to x86 if a dependency requires it.
- Always set `logRetention` explicitly — CDK defaults to RETAIN forever, which accumulates cost and violates the log retention policy (30d dev, 90d prod). Use `logs.RetentionDays.ONE_MONTH` / `THREE_MONTHS`. See `cdk-constructs-standards.md` §8.

## WebSocket API Gateway (chatbot only)

- `WebSocketApi` is in `aws-cdk-lib/aws-apigatewayv2` — completely different module from `RestApi` (`aws-cdk-lib/aws-apigateway`). Don't mix them.
- `WebSocketLambdaIntegration` is in `aws-cdk-lib/aws-apigatewayv2-integrations` — separate package from the API construct.
- `routeSelectionExpression` defaults to `$request.body.action`. This project uses `$default` for all messages — no custom route keys needed.
- Auth can only be set on the `$connect` route — `$default` and `$disconnect` cannot have authorizers. The project's chatbot is unauthenticated; origin validation is done in the `$connect` Lambda instead.
- `grantManageConnections(lambda)` — built-in method on `WebSocketApi` that grants `execute-api:ManageConnections` IAM. Required for `ApiGatewayManagementApi.postToConnection()` to push messages back to clients.
- `WebSocketStage` with `autoDeploy: true` — without `autoDeploy`, route changes require manual deployment.
- WAF can be associated with WebSocket API via `webAclArn` on the stage — same WAF Web ACL as REST API if desired.

## EventBridge Rule

- Event pattern matching is case-sensitive.
- `detailType` in the pattern must exactly match what the publisher sends.
- Dead-letter queue on the rule target catches delivery failures — always configure one.

## S3 Bucket

- `blockPublicAccess: BLOCK_ALL` should be the default on every bucket.
- `enforceSSL: true` requires HTTPS — set it always.
- Removal policy: `RETAIN` for prod, `DESTROY` for dev.
