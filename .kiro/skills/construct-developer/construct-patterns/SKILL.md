---
name: construct-patterns
description: Patterns for creating and modifying reusable L3 CDK constructs. Use when building new constructs, updating existing ones, or designing construct APIs in infra/constructs/.
metadata:
  version: '2.0'
---

## Creating a New Construct

1. Create file at `infra/constructs/{construct-name}.ts`
2. Define a `{ConstructName}Props` interface with TSDoc + `@default` annotations
3. Extend `Construct`, apply defaults in constructor using `??`
4. Expose underlying AWS resources as `public readonly` properties
5. Add helper methods for common operations (e.g., `grantReadData`)
6. Tag resources with `ManagedBy: CDK` and `ConstructType: {name}`
7. Create test at `infra/__tests__/constructs/{construct-name}.test.ts`
8. Run `cdk synth` to verify template generation

## Props Interface Pattern

```typescript
export interface ProjectLambdaFunctionProps {
  /** Path to Lambda handler entry point */
  readonly entry: string;
  /** Deployment environment — drives log retention. */
  readonly environment: 'dev' | 'prod';
  /** Memory size in MB. @default 256 */
  readonly memorySize?: number;
  /** Timeout in seconds. @default 30 */
  readonly timeout?: number;
  /** Environment variables */
  readonly envVars?: Record<string, string>;
  /** VPC for database access */
  readonly vpc?: ec2.IVpc;
}
```

## Construct Implementation Pattern

```typescript
export class ProjectLambdaFunction extends Construct {
  public readonly function: lambda.Function;
  public readonly role: iam.IRole;

  constructor(scope: Construct, id: string, props: ProjectLambdaFunctionProps) {
    super(scope, id);

    const timeout = props.timeout ?? 30;
    const memorySize = props.memorySize ?? 256;
    const logRetention =
      props.environment === 'prod'
        ? logs.RetentionDays.THREE_MONTHS // 90 days
        : logs.RetentionDays.ONE_MONTH; // 30 days

    this.function = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(props.entry),
      timeout: cdk.Duration.seconds(timeout),
      memorySize,
      tracing: lambda.Tracing.ACTIVE,
      logRetention, // REQUIRED — CDK defaults to RETAIN forever
      environment: props.envVars,
      vpc: props.vpc,
    });

    this.role = this.function.role!;
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }

  public grantReadData(table: dynamodb.ITable): void {
    table.grantReadData(this.function);
  }
}
```

## How Backend Devs Consume Constructs

Backend devs use your constructs in `packages/{domain}/infra.ts`. Design APIs that make their code one-liners:

```typescript
const search = new ProjectLambdaFunction(this, 'Search', {
  entry: require.resolve('./handlers/search'),
  environment: 'dev',
  envVars: { DB_SECRET_ARN: props.dbSecretArn },
  vpc: props.vpc,
});
```

## SqsConsumer Construct Pattern

```typescript
export interface SqsConsumerProps {
  /** The SQS queue to consume from */
  readonly queue: sqs.IQueue;
  /** The Lambda function that processes messages */
  readonly handler: ProjectLambdaFunction;
  /** Batch size. @default 10 */
  readonly batchSize?: number;
  /** Enable partial batch failure reporting. @default true */
  readonly reportBatchItemFailures?: boolean;
}

export class SqsConsumer extends Construct {
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: SqsConsumerProps) {
    super(scope, id);

    const batchSize = props.batchSize ?? 10;
    const reportBatchItemFailures = props.reportBatchItemFailures ?? true;

    // DLQ — messages that fail maxReceiveCount times land here
    this.deadLetterQueue = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: cdk.Duration.days(14),
    });

    // Visibility timeout must be >= 6x Lambda timeout (service-gotchas.md)
    const lambdaTimeout = props.handler.function.timeout?.toSeconds() ?? 30;
    (props.queue.node.defaultChild as sqs.CfnQueue).addPropertyOverride(
      'VisibilityTimeout',
      lambdaTimeout * 6,
    );

    // Wire Lambda to SQS
    props.handler.function.addEventSource(
      new lambdaEventSources.SqsEventSource(props.queue, {
        batchSize,
        reportBatchItemFailures,
      }),
    );

    // DLQ alarm — any message = something is broken
    new cloudwatch.Alarm(this, 'DlqAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
```

**Key design decisions:**

- `reportBatchItemFailures` defaults to `true` — without it, one failed message retries the entire batch
- Visibility timeout auto-calculated from Lambda timeout (6x multiplier per AWS best practices)
- DLQ created automatically with 14-day retention
- DLQ alarm at threshold 1 — any message in DLQ triggers alert
- No IAM permissions inside — consumer grants what they need (SES, OpenSearch, etc.)

## Gotchas

- Don't add IAM permissions inside constructs. Let consumers call `grantReadData()` etc. — keeps constructs reusable across domains.
- Always expose the underlying AWS resource as `public readonly` — consumers need escape hatches for edge cases.
- Use `require.resolve()` for entry paths in consumer examples — relative strings break during CDK synth.
- Sensible defaults should cover 80% of use cases. If a prop needs to be set every time, make it required.
- When adding a new construct, backend devs won't know about it until you update `infra/constructs/` exports.

For construct-specific gotchas (SQS visibility timeout, CORS, FIFO queues), see `references/service-gotchas.md`.
