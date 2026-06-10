---
name: construct-testing
description: CDK construct testing with Jest and CDK assertions. Use when writing unit tests, snapshot tests, or integration tests for CDK constructs.
metadata:
  version: '2.0'
---

## Writing a Construct Unit Test

1. Create test at `infra/__tests__/constructs/{construct-name}.test.ts`
2. Create a test `App` and `Stack`
3. Instantiate the construct with test props
4. Use `Template.fromStack(stack)` to get the CloudFormation template
5. Assert on resource properties, counts, and outputs

## Test Template

```typescript
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ProjectLambdaFunction } from '../../constructs/lambda-function';

describe('ProjectLambdaFunction', () => {
  let template: Template;

  beforeEach(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new ProjectLambdaFunction(stack, 'TestFn', {
      entry: 'src/handler.ts',
    });
    template = Template.fromStack(stack);
  });

  test('creates Lambda with defaults', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Timeout: 30,
      TracingConfig: { Mode: 'Active' },
    });
  });

  test('creates exactly one Lambda', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('applies custom memory size', () => {
    const app = new App();
    const stack = new Stack(app, 'CustomStack');
    new ProjectLambdaFunction(stack, 'Fn', {
      entry: 'src/handler.ts',
      memorySize: 512,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
    });
  });
});
```

## Snapshot Test

```typescript
test('matches snapshot', () => {
  expect(template.toJSON()).toMatchSnapshot();
});
```

## Environment-Aware Tests (log retention, removal policies)

After C-4/C-5, `ProjectLambdaFunction` accepts `environment: 'dev' | 'prod'` which drives log retention. Test both paths:

```typescript
test('sets 30-day log retention in dev', () => {
  const app = new App();
  const stack = new Stack(app, 'DevStack');
  new ProjectLambdaFunction(stack, 'Fn', {
    entry: 'src/handler.ts',
    environment: 'dev',
  });
  Template.fromStack(stack).hasResourceProperties('Custom::LogRetention', {
    RetentionInDays: 30,
  });
});

test('sets 90-day log retention in prod', () => {
  const app = new App();
  const stack = new Stack(app, 'ProdStack');
  new ProjectLambdaFunction(stack, 'Fn', {
    entry: 'src/handler.ts',
    environment: 'prod',
  });
  Template.fromStack(stack).hasResourceProperties('Custom::LogRetention', {
    RetentionInDays: 90,
  });
});
```

For stateful constructs (S3, Aurora), test removal policy per environment:

```typescript
test('S3 bucket uses RETAIN in prod', () => {
  const app = new App();
  const stack = new Stack(app, 'ProdStack');
  new ProjectBucket(stack, 'Bucket', { environment: 'prod' });
  Template.fromStack(stack).hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
  });
});

test('S3 bucket uses DELETE in dev', () => {
  const app = new App();
  const stack = new Stack(app, 'DevStack');
  new ProjectBucket(stack, 'Bucket', { environment: 'dev' });
  Template.fromStack(stack).hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Delete',
  });
});
```

## Coverage Requirements

- > 90% for all constructs
- 100% for security-related constructs (IAM, encryption)
- All props paths tested (defaults + custom values)
- All helper methods tested

## Gotchas

- `Template.fromStack()` synthesizes the full CloudFormation template — test against resource properties, not CDK construct properties.
- Use `Match.anyValue()` for generated values (ARNs, logical IDs) that change between synths.
- Snapshot tests break on CDK version upgrades (template format changes). Update snapshots intentionally with `jest --updateSnapshot`.
- Don't test CDK internals — test the CloudFormation output. Your contract is the template, not the construct tree.
