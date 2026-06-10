# CDK Constructs Development Standards

Standards for creating reusable L3 CDK constructs in `infra/constructs/`.

---

## 1. General Principles

- **Reusability**: Design for multiple domains — every domain's `infra.ts` uses the same constructs
- **Best practices baked in**: Tracing, logging, encryption, ARM64 by default
- **Sensible defaults**: 80% of use cases need zero config
- **Composability**: Constructs work together without tight coupling
- **Type safety**: TypeScript strict mode, TSDoc on all props

---

## 2. Technology Stack

- **CDK v2** with TypeScript strict mode
- **Testing**: Jest + CDK assertions (`Template`, `Match`)
- **Compute**: Lambda only — no ECS, no containers
- **Database**: Aurora Serverless v2 (PostgreSQL) — constructs may need VPC access
- **API**: API Gateway REST with Cognito authorizer

---

## 3. Project Structure

```
infra/
  constructs/
    lambda-function.ts          # ProjectLambdaFunction
    api-route.ts                # ProjectApiRoute
    sqs-consumer.ts             # SqsConsumer
  stacks/
    stateful.ts                 # VPC, Aurora, ElastiCache, OpenSearch, S3, Cognito, Secrets Manager
    stateless.ts                # API Gateway, WAF, all domain Lambdas, SQS, EventBridge, SES, CloudWatch
  config/
    dev.ts                      # Dev environment config
    prod.ts                     # Production environment config (UWM account)
  __tests__/
    constructs/                 # Construct unit tests
```

**Rules:**

- Constructs live in `infra/constructs/` only
- One construct per file
- Tests co-located in `infra/__tests__/constructs/`
- Two stacks: StatefulStack (data, never destroy) and StatelessStack (compute, deploy often)
- Stacks compose constructs — `stateless.ts` instantiates domain infra constructs

---

## 4. Construct Levels

- **L1**: CloudFormation resources (`CfnXxx`) — use only when L2 doesn't exist
- **L2**: AWS constructs with helper methods — use as building blocks
- **L3**: What you build — opinionated patterns combining multiple L2 constructs

---

## 5. Props Interface Design

```typescript
export interface ProjectLambdaFunctionProps {
  /** Path to Lambda handler entry point */
  readonly entry: string;

  /** Deployment environment — drives log retention and removal policies. */
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

**Rules:**

- `readonly` on all properties
- TSDoc with `@default` and `@example` on optional props
- Use CDK types (`Duration`, `Size`) over primitives where appropriate
- Required props are explicit, optional props have defaults
- Validate props early in constructor

---

## 6. Construct Implementation

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
        ? logs.RetentionDays.THREE_MONTHS // 90 days — §8 Log Retention
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
}
```

**Rules:**

- Extend `Construct` base class
- Apply defaults with `??` operator in constructor
- Expose underlying resources as `public readonly`
- Add helper methods for common operations
- Tag resources for tracking
- Don't add IAM permissions inside constructs — let consumers grant what they need

---

## 7. Testing Standards

### Unit Tests

```typescript
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ProjectLambdaFunction } from '../../constructs/lambda-function';

describe('ProjectLambdaFunction', () => {
  test('creates Lambda with defaults', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new ProjectLambdaFunction(stack, 'TestFn', { entry: 'src/handler.ts' });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Timeout: 30,
      TracingConfig: { Mode: 'Active' },
    });
  });

  test('applies custom memory size', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new ProjectLambdaFunction(stack, 'TestFn', { entry: 'src/handler.ts', memorySize: 512 });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
    });
  });
});
```

### Snapshot Tests

```typescript
test('matches snapshot', () => {
  expect(template.toJSON()).toMatchSnapshot();
});
```

**Coverage:**

- > 90% for all constructs
- All props paths tested (defaults + custom values)
- All helper methods tested

---

## 8. CDK Best Practices (from docs/code-structure.md §8)

### Stack Protection

`StatefulStack` MUST have `terminationProtection: true` in prod. This prevents accidental deletion of Aurora, OpenSearch, S3, and Cognito. `StatelessStack` does NOT need termination protection — it can be freely destroyed and recreated without data loss.

```typescript
new StatefulStack(app, 'ProjectStatefulStack', {
  terminationProtection: config.envName === 'prod',
  // ...
});
```

Constructs must enforce these conventions from the [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html).

### Removal Policies

Constructs that create stateful resources MUST accept an `environment` or `removalPolicy` prop and apply the correct policy:

| Resource            | Dev       | Prod                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aurora cluster      | `DESTROY` | `RETAIN`                                                                                                                                                                                                                                                                                                                                                                  |
| S3 buckets          | `DESTROY` | `RETAIN`                                                                                                                                                                                                                                                                                                                                                                  |
| OpenSearch domain   | `DESTROY` | `RETAIN`                                                                                                                                                                                                                                                                                                                                                                  |
| Cognito user pools  | `DESTROY` | `RETAIN`                                                                                                                                                                                                                                                                                                                                                                  |
| ElastiCache (Redis) | `DESTROY` | `DESTROY` — confirmed rebuildable for this project's use cases: chatbot rate-limit counters (reset = fresh window, acceptable), connection metadata (widget reconnects via AgentCore session persistence), RBAC permission cache (5-min TTL, self-healing DB fallback). If Redis is later used for non-rebuildable state (session tokens, distributed locks), revisit this policy. |

### Log Retention

`ProjectLambdaFunction` MUST set explicit log retention — CDK defaults to RETAIN forever:

| Environment | Log Retention |
| ----------- | ------------- |
| Dev         | 30 days       |
| Prod        | 90 days       |

**Audit logs are separate.** Application/Lambda logs (90 days) are distinct from audit trail entries written by `audit-logger.ts`. Audit logs must ship to a dedicated S3 bucket with a 6-year retention lifecycle rule and S3 Object Lock (COMPLIANCE mode). See `docs/cdk-stack-design-analysis.md` — Security Review Findings for details. This is a pending compliance item pending HIPAA BAA confirmation.

### Resource Naming

Do NOT hardcode physical names (`bucketName`, `clusterIdentifier`, etc.) on stateful resources. Let CDK generate names. Pass generated names/ARNs to consumers via construct properties (e.g., `this.bucket.bucketName`).

### Logical ID Stability

Never change the construct `id` of stateful resources after initial deployment — it causes resource replacement. Write snapshot tests that catch accidental logical ID changes.

### Deterministic Synthesis

`cdk.context.json` MUST be committed to version control. It caches `.fromLookup()` results (VPC, AZ selections) to ensure `cdk synth` produces identical templates across machines. Without it, a new developer's first synth could produce different subnet layouts or AZ assignments.

Per [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html): "You should commit this to version control along with the rest of your code."

- Do NOT add `cdk.context.json` to `.gitignore`
- No AWS SDK calls during synthesis — all env-specific values come from `infra/config/`
- No CloudFormation Parameters or Conditions — all decisions at synthesis time in TypeScript

### WebSocket API — No Reusable Construct (Architecture Decision)

The chatbot domain uses API Gateway WebSocket API (`WebSocketApi`, `WebSocketStage`, `WebSocketLambdaIntegration` from `aws-cdk-lib/aws-apigatewayv2`). **Do NOT build a reusable L3 construct for this.** Wire directly in `packages/chatbot/infra.ts` using CDK L2 constructs.

**Rationale:**

- Single consumer — chatbot is the only WebSocket user in this project (confirmed: `frontend-screen-development-guide.md`)
- CDK L2 is already clean — `connectRouteOptions`, `grantManageConnections()`, one-liner route wiring
- All complexity is chatbot-specific (WAF, origin validation, rate limiting, kill switch, AgentCore) — nothing generalizable
- Extract to L3 only if a second WebSocket use case appears

---

## 9. Security

- Enable encryption at rest by default (Aurora, S3, OpenSearch)
- Enforce TLS 1.2+ in transit
- Block public access on S3 buckets by default
- No wildcard IAM permissions inside constructs
- Use Secrets Manager for credentials, not environment variables

### CDK Nag

Register `AwsSolutionsChecks` as an Aspect in `infra/bin/app.ts` — not as a grep on `cdk synth` output:

```typescript
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
```

Violations throw at synth time and block the CI pipeline. Minimum rules enforced: `AwsSolutions-IAM4` (no AWS managed policies), `AwsSolutions-IAM5` (no wildcard on sensitive actions).

**HIPAA rule pack (pending BAA):** cdk-nag also provides `HIPAASecurityChecks`. Add it when the HIPAA BAA with AWS is confirmed:

```typescript
import { HIPAASecurityChecks } from 'cdk-nag';
Aspects.of(app).add(new HIPAASecurityChecks({ verbose: true }));
```

Do not add before BAA confirmation — it generates findings (encryption, logging, backup) that may not be actionable until the BAA is in place. Track status in `docs/cdk-stack-design-analysis.md`.

### IAM Review Policy

Any change to `packages/*/infra.ts`, `infra/stacks/`, or `infra/constructs/` requires a mandatory second reviewer via GitHub branch protection rules. This mitigates the CDK limitation where NestedStack IAM changes are not shown in `cdk deploy` security prompts.

---

## 10. Code Quality

- **Prettier** + **ESLint** — enforced in CI
- TypeScript strict mode — no `any`
- `cdk synth` must pass before merge

---

## 11. Definition of Done

- [ ] Construct follows design standards
- [ ] TypeScript strict mode, no `any`
- [ ] Props interface documented with TSDoc
- [ ] Sensible defaults provided
- [ ] Unit tests passing (>90% coverage)
- [ ] Snapshot tests capture CloudFormation template
- [ ] Stateful resources use environment-aware removal policies (§8)
- [ ] Lambda log retention explicitly set (§8)
- [ ] No hardcoded physical resource names (§8)
- [ ] Resources tagged appropriately
- [ ] Security best practices followed
- [ ] Code formatted with Prettier, passes ESLint
- [ ] `cdk synth` succeeds
