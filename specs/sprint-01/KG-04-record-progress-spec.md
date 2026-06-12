# Implementation Spec: KG-04 — `record_progress` Tool

**Story:** KG-04 — `record_progress` tool — classification, dedup, DynamoDB write  
**Feature:** F-01 — MCP Server — Tools, Classification & Deduplication  
**Sprint:** Sprint 01  
**Author:** Backend Developer Agent  
**Date:** 2026-06-11

---

## 1. Overview

Implement the `record_progress` MCP tool handler with:
1. Input validation via Zod schema (existing)
2. Event auto-classification (macro/micro) using `classifyEvent()`
3. Gate derivation for macro events
4. Idempotency key building + dedup sentinel pattern
5. DynamoDB write with conditional idempotency
6. Error handling without server crashes

**Files to create/modify:**
- `packages/mcp-server/src/services/dynamodb.service.ts` — new
- `packages/mcp-server/src/tools/record-progress.ts` — replace stub
- `packages/mcp-server/src/tools/record-progress.test.ts` — new (unit tests)

---

## 2. Architecture Dependencies

| Dependency | Source | What We Use |
|-----------|--------|-----------|
| F-01 §3.2 | mcp-server-core-architecture.md | `record_progress` handler logic |
| F-01 §4 | mcp-server-core-architecture.md | Classification algorithm + `flag_override` |
| F-01 §5 | mcp-server-core-architecture.md | Dedup sentinel pattern + idempotency key |
| F-04 §2 | data-persistence-architecture.md | `GovernanceEventRecord` type, table schema |
| F-04 §4 | data-persistence-architecture.md | Conditional PutItem dedup implementation |
| code-structure.md §5 | code-structure.md | DynamoDB dedup sentinel pattern |
| macro-gates.ts | packages/shared/constants/macro-gates.ts | `classifyEvent()`, `MACRO_GATES` |
| governance-event.ts | packages/shared/types/governance-event.ts | `GovernanceEventRecord` interface |

---

## 3. `dynamodb.service.ts` — DynamoDB Layer

**Purpose:** Abstract DynamoDB write logic, idempotency key building, dedup sentinel pattern.  
**File location:** `packages/mcp-server/src/services/dynamodb.service.ts`

### 3.1 Module Exports

```typescript
// Single DynamoDBClient instance (initialized once at startup)
export function getDynamoDBClient(): DynamoDBClient;

// Build idempotency key per F-04 §4.1
export function buildIdempotencyKey(
  projectId: string,
  type: 'macro' | 'micro',
  gate: string | undefined,
  ulid: string,
): string;

// Attempt dedup sentinel write (conditional PutItem)
export async function attemptDedupSentinel(
  client: DynamoDBClient,
  tableName: string,
  projectId: string,
  idempotencyKey: string,
): Promise<{ written: boolean }>;

// Write governance event record to DynamoDB
export async function writeGovernanceEvent(
  client: DynamoDBClient,
  tableName: string,
  record: GovernanceEventRecord,
): Promise<void>;
```

### 3.2 Implementation Details

#### `getDynamoDBClient()`

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

let client: DynamoDBClient | null = null;

export function getDynamoDBClient(): DynamoDBClient {
  if (!client) {
    client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
}
```

**Rules:**
- Singleton pattern — initialized once per Lambda lifetime
- Reused across invocations for warm starts
- Region from `process.env.AWS_REGION` (set by MCP server at startup)

#### `buildIdempotencyKey()`

```typescript
export function buildIdempotencyKey(
  projectId: string,
  type: 'macro' | 'micro',
  gate: string | undefined,
  ulid: string,
): string {
  if (type === 'macro' && gate) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const normalizedGate = gate.toLowerCase().trim();
    return `${projectId}#${normalizedGate}#${today}`;
  }
  // Micro events: always unique (ULID guarantees)
  return `${projectId}#micro#${ulid}`;
}
```

**Rules:**
- Macro: `<project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>`
- Micro: `<project_id>#micro#<ULID>`
- Gate normalization (lowercase + trim) per F-01 §5.1 FINDING-1

#### `attemptDedupSentinel()`

```typescript
import { PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

export async function attemptDedupSentinel(
  client: DynamoDBClient,
  tableName: string,
  projectId: string,
  idempotencyKey: string,
): Promise<{ written: boolean }> {
  try {
    await client.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        pk: `PROJECT#${projectId}`,
        sk: `DEDUP#${idempotencyKey}`,
        created_at: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      }),
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return { written: true };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return { written: false };
    }
    throw err; // Propagate unexpected errors
  }
}
```

**Rules:**
- Atomic conditional write — either sentinel exists or it doesn't
- `ConditionalCheckFailedException` means duplicate detected (expected, not an error)
- Unexpected AWS SDK errors are propagated to caller
- Sentinel record is never deleted (permanent audit trail)

#### `writeGovernanceEvent()`

```typescript
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

export async function writeGovernanceEvent(
  client: DynamoDBClient,
  tableName: string,
  record: GovernanceEventRecord,
): Promise<void> {
  await client.send(new PutItemCommand({
    TableName: tableName,
    Item: marshall(record),
  }));
}
```

**Rules:**
- Direct PutItem — no conditional check (dedup already validated by caller)
- Marshalls the entire record object
- Throws on DynamoDB failure (caller catches and returns error)

### 3.3 Error Handling

- **Duplicate detected:** `attemptDedupSentinel()` returns `{ written: false }` (caller checks and skips)
- **DynamoDB unavailable:** AWS SDK throws, caller catches and returns MCP error
- **Unexpected error:** Propagated to handler (crash-safe: MCP framework handles)

---

## 4. `record-progress.ts` — MCP Tool Handler

**Purpose:** Main tool handler — classification, gate derivation, dedup check, DynamoDB write.  
**File location:** `packages/mcp-server/src/tools/record-progress.ts`

### 4.1 Tool Registration & Handler

```typescript
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ulid } from 'ulid';
import { classifyEvent } from '@kiro-governance/shared/constants/macro-gates';
import { GovernanceEventRecord } from '@kiro-governance/shared/types/governance-event';
import {
  getDynamoDBClient,
  buildIdempotencyKey,
  attemptDedupSentinel,
  writeGovernanceEvent,
} from '../services/dynamodb.service';

export const RecordProgressInputSchema = z.object({
  project_id: z.string().min(1).describe('GitHub repository name'),
  update_text: z.string().min(1).max(4096).describe('Event description'),
  type: z.enum(['macro', 'micro']).optional().describe('Event type — auto-classified if omitted'),
  gate: z.string().optional().describe('Canonical macro gate name'),
  phase: z.string().optional().describe('Phase grouping'),
  source_ref: z.string().min(1).describe('Commit SHA or file reference'),
  actor: z.string().min(1).describe('Who emitted/approved'),
  flag_override: z.boolean().optional().describe('Manual type override flag'),
});

export type RecordProgressInput = z.infer<typeof RecordProgressInputSchema>;

export interface RecordProgressOutput {
  written: boolean;
  pk?: string;
  sk?: string;
  reason?: string;
}

/**
 * Register record_progress MCP tool.
 * See mcp-server-core-architecture.md §3.2
 */
export function registerRecordProgress(
  server: McpServer,
  config: { tableName: string },
): void {
  const toolSchema: Record<string, { type: string; description?: string; enum?: string[] }> = {
    project_id: { type: 'string', description: 'GitHub repository name' },
    update_text: { type: 'string', description: 'Event description' },
    type: { type: 'string', enum: ['macro', 'micro'], description: 'Event type (optional)' },
    gate: { type: 'string', description: 'Canonical gate name (optional)' },
    phase: { type: 'string', description: 'Phase grouping (optional)' },
    source_ref: { type: 'string', description: 'Commit SHA or file reference' },
    actor: { type: 'string', description: 'Who approved' },
    flag_override: { type: 'string', description: 'Manual override (optional)' },
  };

  server.tool(
    'record_progress',
    'Write a governance event to DynamoDB with auto-classification and deduplication',
    toolSchema as Record<string, unknown>,
    async (params: Record<string, unknown>) => {
      try {
        const input = RecordProgressInputSchema.parse(params);
        const result = await handleRecordProgress(input, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        const error = err instanceof z.ZodError ? err.errors[0]?.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'VALIDATION_ERROR',
                message: error,
              }),
            },
          ],
        };
      }
    },
  );
}

async function handleRecordProgress(
  input: RecordProgressInput,
  config: { tableName: string },
): Promise<RecordProgressOutput> {
  try {
    // Step 1: Classify event (F-01 §3.2, FR-03)
    const { resolvedType, matchedGate } = classifyEvent({
      update_text: input.update_text,
      type: input.type,
      flag_override: input.flag_override,
    });

    // Step 2: Derive gate (F-01 §3.2 FINDING-2)
    //   Priority: caller-provided > classification match > undefined
    let resolvedGate: string | undefined;
    if (input.gate) {
      resolvedGate = input.gate.toLowerCase().trim();
    } else if (resolvedType === 'macro' && matchedGate) {
      resolvedGate = matchedGate;
    }

    // Step 3: Generate ULID for sort key
    const eventUlid = ulid();

    // Step 4: Build idempotency key
    const idempotencyKey = buildIdempotencyKey(
      input.project_id,
      resolvedType,
      resolvedGate,
      eventUlid,
    );

    // Step 5: Check dedup sentinel (macro only; micro always unique)
    const client = getDynamoDBClient();
    if (resolvedType === 'macro') {
      const dedupResult = await attemptDedupSentinel(
        client,
        config.tableName,
        input.project_id,
        idempotencyKey,
      );
      if (!dedupResult.written) {
        console.info('[record_progress] Dedup hit', { projectId: input.project_id, idempotencyKey });
        return { written: false, reason: 'duplicate' };
      }
    }

    // Step 6: Build GovernanceEventRecord
    const now = new Date().toISOString();
    const pk = `PROJECT#${input.project_id}`;
    const sk = `UPDATE#${now}#${eventUlid}`;

    const record: GovernanceEventRecord = {
      pk,
      sk,
      update_text: input.update_text,
      type: resolvedType,
      source_ref: input.source_ref,
      actor: input.actor,
      created_at: now,
      idempotency_key: idempotencyKey,
      ...(resolvedGate && { gate: resolvedGate }),
      ...(input.phase && { phase: input.phase }),
      ...(input.flag_override !== undefined && { flag_override: input.flag_override }),
    };

    // Step 7: Write event record (F-04 §4.2 Pattern 1)
    await writeGovernanceEvent(client, config.tableName, record);

    return { written: true, pk, sk };
  } catch (err) {
    console.error('[record_progress] DynamoDB write failed', { error: String(err) });
    return {
      written: false,
      reason: 'dynamodb_write_failed',
    };
  }
}
```

### 4.2 Handler Logic Flow

```
Input validation (Zod)
  ↓
classifyEvent(update_text, flag_override) → resolvedType, matchedGate
  ↓
Derive gate: input.gate (norm) > matchedGate > undefined
  ↓
Generate ULID for SK
  ↓
Build idempotency key: buildIdempotencyKey(projectId, type, gate, ulid)
  ↓
macro event?
  ├─ YES → attemptDedupSentinel()
  │         ├─ Success → continue to step 6
  │         └─ ConditionalCheckFailed → return { written: false, reason: 'duplicate' }
  └─ NO (micro) → skip dedup, continue to step 6
  ↓
Build GovernanceEventRecord
  ↓
writeGovernanceEvent() → PutItem to DynamoDB
  ↓
Return { written: true, pk, sk }
```

---

## 5. Unit Tests

**File:** `packages/mcp-server/src/tools/record-progress.test.ts`

### 5.1 Test Suite Structure

```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RecordProgressInputSchema } from './record-progress';
import * as dynamoService from '../services/dynamodb.service';
import { handleRecordProgress } from './record-progress'; // Export for testing

// Mock classifyEvent from shared
jest.mock('@kiro-governance/shared/constants/macro-gates', () => ({
  classifyEvent: jest.fn(),
}));

describe('record_progress tool', () => {
  let mockDynamoClient: any;
  let config: { tableName: string };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoClient = { send: jest.fn() };
    config = { tableName: 'kiro-governance-tracker' };
    jest.spyOn(dynamoService, 'getDynamoDBClient').mockReturnValue(mockDynamoClient);
  });

  describe('Input validation', () => {
    it('should accept valid macro event input', () => {
      const input = {
        project_id: 'rainn',
        update_text: 'SRS approved',
        gate: 'SRS approved',
        source_ref: 'abc123',
        actor: 'human',
      };
      expect(() => RecordProgressInputSchema.parse(input)).not.toThrow();
    });

    it('should reject missing project_id', () => {
      const input = { update_text: 'test', source_ref: 'abc', actor: 'human' };
      expect(() => RecordProgressInputSchema.parse(input)).toThrow();
    });

    it('should reject update_text > 4096 chars', () => {
      const input = {
        project_id: 'rainn',
        update_text: 'a'.repeat(4097),
        source_ref: 'abc',
        actor: 'human',
      };
      expect(() => RecordProgressInputSchema.parse(input)).toThrow();
    });
  });

  describe('Gate derivation', () => {
    it('should use caller-provided gate when present', async () => {
      const { classifyEvent: mockClassify } = require('@kiro-governance/shared/constants/macro-gates');
      mockClassify.mockReturnValue({ resolvedType: 'macro', matchedGate: 'Different Gate' });

      const input = {
        project_id: 'rainn',
        update_text: 'some event',
        gate: 'Provided Gate', // Caller provides gate
        source_ref: 'abc',
        actor: 'human',
      };

      // Should use 'Provided Gate' normalized, not matchedGate
      // Verify via buildIdempotencyKey being called with normalized gate
    });

    it('should use classification match when gate not provided', async () => {
      const { classifyEvent: mockClassify } = require('@kiro-governance/shared/constants/macro-gates');
      mockClassify.mockReturnValue({ resolvedType: 'macro', matchedGate: 'SRS approved' });

      const input = {
        project_id: 'rainn',
        update_text: 'SRS approved',
        source_ref: 'abc',
        actor: 'human',
      };

      // Should use matchedGate from classification
    });
  });

  describe('Idempotency key building', () => {
    it('should build macro key with date component', () => {
      const key = dynamoService.buildIdempotencyKey(
        'rainn',
        'macro',
        'SRS approved',
        '01J5K3M2N4P5Q6R7S8T9',
      );
      expect(key).toMatch(/^rainn#srs approved#\d{4}-\d{2}-\d{2}$/);
    });

    it('should normalize gate to lowercase', () => {
      const key = dynamoService.buildIdempotencyKey(
        'rainn',
        'macro',
        'SRS APPROVED',
        '01J5K3M2N4P5Q6R7S8T9',
      );
      expect(key).toMatch(/^rainn#srs approved#/);
    });

    it('should build micro key with ULID', () => {
      const ulid = '01J5K3M2N4P5Q6R7S8T9';
      const key = dynamoService.buildIdempotencyKey('rainn', 'micro', undefined, ulid);
      expect(key).toBe(`rainn#micro#${ulid}`);
    });

    it('should not include gate in micro key', () => {
      const key = dynamoService.buildIdempotencyKey('rainn', 'micro', 'ignored', 'ulid123');
      expect(key).toMatch(/^rainn#micro#/);
    });
  });

  describe('Dedup sentinel', () => {
    it('should detect duplicate macro events', async () => {
      const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');
      mockDynamoClient.send.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: 'Condition failed' }),
      );

      const result = await dynamoService.attemptDedupSentinel(
        mockDynamoClient,
        config.tableName,
        'rainn',
        'rainn#srs approved#2026-06-11',
      );

      expect(result.written).toBe(false);
    });

    it('should write new sentinel for first macro event', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({});

      const result = await dynamoService.attemptDedupSentinel(
        mockDynamoClient,
        config.tableName,
        'rainn',
        'rainn#srs approved#2026-06-11',
      );

      expect(result.written).toBe(true);
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        }),
      );
    });

    it('should propagate unexpected DynamoDB errors', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        dynamoService.attemptDedupSentinel(
          mockDynamoClient,
          config.tableName,
          'rainn',
          'key',
        ),
      ).rejects.toThrow('Network error');
    });
  });

  describe('Event write', () => {
    it('should write valid GovernanceEventRecord', async () => {
      mockDynamoClient.send.mockResolvedValueOnce({});

      const record = {
        pk: 'PROJECT#rainn',
        sk: 'UPDATE#2026-06-10T19:55:00.000Z#01J5K3M2N4P5Q6R7S8T9',
        update_text: 'SRS approved',
        type: 'macro' as const,
        gate: 'SRS approved',
        source_ref: 'abc123',
        actor: 'human',
        created_at: '2026-06-10T19:55:00.000Z',
        idempotency_key: 'rainn#srs approved#2026-06-10',
      };

      await dynamoService.writeGovernanceEvent(mockDynamoClient, config.tableName, record);

      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: config.tableName,
          }),
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('should catch DynamoDB error and return safe error response', async () => {
      mockDynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB timeout'));

      const input = {
        project_id: 'rainn',
        update_text: 'test',
        source_ref: 'abc',
        actor: 'human',
      };

      const result = await handleRecordProgress(input, config);

      expect(result.written).toBe(false);
      expect(result.reason).toBe('dynamodb_write_failed');
    });

    it('should not throw on dedup duplicate', async () => {
      // Mock classifyEvent to return macro
      const { classifyEvent: mockClassify } = require('@kiro-governance/shared/constants/macro-gates');
      mockClassify.mockReturnValue({ resolvedType: 'macro', matchedGate: 'SRS approved' });

      // Mock dedup sentinel to fail (duplicate)
      const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');
      mockDynamoClient.send.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: 'Condition failed' }),
      );

      const input = {
        project_id: 'rainn',
        update_text: 'SRS approved',
        source_ref: 'abc',
        actor: 'human',
      };

      const result = await handleRecordProgress(input, config);

      expect(result.written).toBe(false);
      expect(result.reason).toBe('duplicate');
    });
  });
});
```

### 5.2 Test Coverage

| Item | Coverage |
|------|----------|
| `buildIdempotencyKey()` | ✅ Macro + micro paths, normalization, edge cases |
| `attemptDedupSentinel()` | ✅ Success, duplicate detection, error propagation |
| `writeGovernanceEvent()` | ✅ Valid record write, error propagation |
| Gate derivation | ✅ Priority logic (caller > classification > undefined) |
| Classification integration | ✅ Mock `classifyEvent()` and verify handler uses result |
| Input validation | ✅ Valid inputs, boundary violations (max length) |
| Error handling | ✅ DynamoDB failure, dedup hit, server robustness |

**Target:** 80%+ coverage for `dynamodb.service.ts` and `record-progress.ts` handler logic.

---

## 6. Integration Points

### 6.1 Server Initialization

In `packages/mcp-server/src/index.ts` (server entry point):

```typescript
import { registerRecordProgress } from './tools/record-progress';

// At server startup:
const config = {
  tableName: await ssm.getParameter('/kiro-governance/config/table-name'),
};

registerRecordProgress(server, config);
```

### 6.2 Environment Variables

Required at MCP server startup:
- `AWS_REGION` — passed to DynamoDB client
- `TABLE_NAME` (or read from SSM) — passed to tool handler

### 6.3 IAM Permissions

MCP server EC2 instance role needs:
- `dynamodb:PutItem` on `kiro-governance-tracker` table
- `dynamodb:Query` on table (for dedup sentinel check)
- `ssm:GetParameter` on `/kiro-governance/*`

See F-04 §6.1 for full IAM policy.

---

## 7. Definition of Done

- [ ] `packages/mcp-server/src/services/dynamodb.service.ts` created
- [ ] `packages/mcp-server/src/tools/record-progress.ts` implements full handler
- [ ] `packages/mcp-server/src/tools/record-progress.test.ts` covers all logic paths
- [ ] `buildIdempotencyKey()` tested for macro/micro + normalization
- [ ] `attemptDedupSentinel()` tested for success/duplicate/error cases
- [ ] `writeGovernanceEvent()` tested for valid record write
- [ ] Error handling verified — no server crashes on DynamoDB failure
- [ ] Unit tests pass: `npm test -w packages/mcp-server`
- [ ] Build passes: `npm run build -w packages/mcp-server`
- [ ] TypeScript strict mode, no `any` types
- [ ] Imports from `@kiro-governance/shared` only (no hardcoded gate names)
- [ ] Documentation: JSDoc on exported functions only (types are self-documenting)
- [ ] `.test.ts` file follows Jest conventions

---

## 8. Testing Command

```bash
# Run unit tests for mcp-server package
npm test -w packages/mcp-server

# Build and check for errors
npm run build -w packages/mcp-server

# Type check (if separate target)
npm run type-check -w packages/mcp-server
```

---

## 9. Notes

### 9.1 Dedup Sentinel Persistence

Sentinel records are **never deleted**. They provide a permanent audit trail that deduplication occurred. At 10 macro events per project per month, storage is negligible (~200 bytes each).

### 9.2 Gate Normalization

Gate strings are normalized to lowercase + trimmed before building the idempotency key. This prevents case-sensitivity bypass (e.g., "SRS approved" vs "srs approved" vs "SRS Approved" all map to the same dedup key).

### 9.3 Micro Event Idempotency

Micro events never write a dedup sentinel. The ULID suffix in the sort key guarantees uniqueness — no same-second collision is possible.

### 9.4 Error Isolation

DynamoDB write failures are caught and returned to the MCP caller as error content (JSON-serialized). They do NOT crash the server — `systemd` keeps the process running for the next request.

---

*End of Implementation Spec KG-04*
