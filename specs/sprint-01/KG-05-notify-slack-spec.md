# KG-05 Implementation Spec: `notify_slack` Tool

**Story:** KG-05 — Slack Notification Tool (`notify_slack` MCP tool)

**Feature:** F-01 — MCP Server — Tools, Classification & Deduplication

**Architecture Docs:**
- `docs/phase1/mcp-server-core-architecture.md` §3.1 (Tool definition)
- `docs/phase1/mcp-server-core-architecture.md` §6 (Slack Integration)
- `docs/code-structure.md` §2–3 (Project layout, tool handler pattern)

**Acceptance Criteria (SRS FR-01, OQ-01, OQ-04):**
- ✅ SSM lookup for webhook URL per `project_id`
- ✅ Slack POST with message text
- ✅ Macro events only (skip micro)
- ✅ p95 < 5s (3s Slack timeout, SSM cached)
- ✅ Generic error messages (no SSM paths exposed)

---

## 1. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/mcp-server/src/tools/notify-slack.ts` | Modify | MCP tool handler — orchestrates logic |
| `packages/mcp-server/src/services/slack.service.ts` | Create | Business logic — SSM + Slack POST |

**No changes to `packages/mcp-server/src/index.ts`** — server already initializes SSM client and passes config to tool registrar.

---

## 2. `slack.service.ts` — Business Logic Layer

**Location:** `packages/mcp-server/src/services/slack.service.ts`

**Exports:**
- `getWebhookUrl(projectId: string): Promise<string>` — SSM lookup with 5-min TTL cache
- `postToSlack(webhookUrl: string, message: string): Promise<void>` — HTTPS POST to Slack

**Implementation:**

```typescript
import https from 'node:https';
import { SSMClient, GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';

/**
 * Custom error class for Slack service errors.
 */
class SlackServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlackServiceError';
  }
}

/**
 * Webhook URL cache with TTL (5 minutes per F-01 §6).
 * Updated per-request on cache miss; stores (url, expiresAt).
 */
const webhookCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Get Slack webhook URL for a project via SSM lookup.
 * Cache in-memory with 5-min TTL to avoid repeated SSM calls.
 *
 * Throws SlackServiceError with code:
 * - 'PROJECT_NOT_FOUND': SSM parameter does not exist (generic error, no path exposed)
 * - 'SSM_ERROR': Unexpected SSM error (generic error, no details exposed)
 *
 * F-01 §3.1 LOW-8: "Remove SSM path from error response" — error messages are generic.
 */
export async function getWebhookUrl(
  ssmClient: SSMClient,
  projectId: string,
): Promise<string> {
  const now = Date.now();

  // Check cache
  const cached = webhookCache.get(projectId);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }

  // Cache miss or expired — fetch from SSM
  try {
    const ssmPath = `/kiro-governance/slack/webhooks/${projectId}`;
    const result = await ssmClient.send(
      new GetParameterCommand({
        Name: ssmPath,
        WithDecryption: true,
      }),
    );

    const webhookUrl = result.Parameter?.Value;
    if (!webhookUrl) {
      throw new SlackServiceError('PROJECT_NOT_FOUND', 'Webhook not found for project');
    }

    // Cache with 5-min TTL
    const expiresAt = now + 5 * 60 * 1000;
    webhookCache.set(projectId, { url: webhookUrl, expiresAt });

    return webhookUrl;
  } catch (err) {
    if (err instanceof ParameterNotFound || (err instanceof Error && err.message.includes('ParameterNotFound'))) {
      // SSM parameter does not exist — generic error to caller
      throw new SlackServiceError('PROJECT_NOT_FOUND', 'Webhook not found for project');
    }
    // Unexpected SSM error
    if (err instanceof SlackServiceError) {
      throw err;
    }
    throw new SlackServiceError('SSM_ERROR', 'Failed to retrieve webhook configuration');
  }
}

/**
 * POST to Slack webhook with message.
 *
 * Message body: { text: message }
 * Timeout: 3 seconds per F-01 §6.4 (3s timeout, p95 target)
 *
 * Throws SlackServiceError with code:
 * - 'SLACK_POST_FAILED': Non-2xx HTTP response
 * - 'SLACK_TIMEOUT': Request exceeded timeout
 * - 'SLACK_NETWORK_ERROR': Network unreachable
 */
export async function postToSlack(
  webhookUrl: string,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: message });

    let req: https.ClientRequest;
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new SlackServiceError('SLACK_TIMEOUT', 'Slack request timed out'));
    }, 3000);

    try {
      req = https.request(webhookUrl, { method: 'POST' }, (res) => {
        let responseData = '';

        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });

        res.on('end', () => {
          clearTimeout(timeout);

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new SlackServiceError(
                'SLACK_POST_FAILED',
                `Slack returned status ${res.statusCode}`,
              ),
            );
          } else {
            resolve();
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
          reject(new SlackServiceError('SLACK_NETWORK_ERROR', 'Network unreachable'));
        } else {
          reject(new SlackServiceError('SLACK_POST_FAILED', err.message));
        }
      });

      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(body));
      req.write(body);
      req.end();
    } catch (err) {
      clearTimeout(timeout);
      reject(new SlackServiceError('SLACK_POST_FAILED', 'Failed to create request'));
    }
  });
}

/**
 * Re-export error class for tool handlers to catch and handle.
 */
export { SlackServiceError };
```

---

## 3. `notify-slack.ts` — MCP Tool Handler

**Location:** `packages/mcp-server/src/tools/notify-slack.ts`

**Exports:**
- `registerNotifySlack(server: McpServer, config: ServerConfig): void` — Register tool on MCP server
- Input schema: `NotifySlackInputSchema` (Zod)

**Implementation:**

```typescript
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSMClient } from '@aws-sdk/client-ssm';
import { getWebhookUrl, postToSlack, SlackServiceError } from '../services/slack.service.js';

/**
 * Input schema for notify_slack tool.
 * Per F-01 §3.1 — exact fields required by specification.
 */
export const NotifySlackInputSchema = z.object({
  project_id: z.string().min(1).describe('GitHub repository name'),
  message: z.string().min(1).describe('Notification message text'),
  event_type: z.enum(['macro', 'micro']).describe('Event classification'),
});

export type NotifySlackInput = z.infer<typeof NotifySlackInputSchema>;

/**
 * Output interface.
 */
export interface NotifySlackOutput {
  notified: boolean;
  reason?: string;
}

/**
 * Register notify_slack MCP tool.
 * Tool is called after record_progress succeeds (macro events only).
 * See F-01 §3.1 for architecture and error handling.
 */
export function registerNotifySlack(
  server: McpServer,
  config: { ssmClient: SSMClient },
): void {
  server.tool(
    'notify_slack',
    'Send a Slack notification for governance event (macro events only)',
    NotifySlackInputSchema.shape as Record<string, any>,
    async (params: unknown): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await handleNotifySlack(params as unknown, config.ssmClient);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}

/**
 * Handler logic for notify_slack tool.
 * Per F-01 §3.1:
 * 1. Validate input (Zod schema)
 * 2. Skip if micro event
 * 3. Retrieve webhook URL from SSM (catch PROJECT_NOT_FOUND)
 * 4. POST to Slack (catch SLACK_POST_FAILED)
 * 5. Return result
 */
async function handleNotifySlack(
  params: unknown,
  ssmClient: SSMClient,
): Promise<NotifySlackOutput> {
  // 1. Validate input
  const input = NotifySlackInputSchema.parse(params);

  // 2. Skip if micro event (macro-only per F-01 §3.1)
  if (input.event_type === 'micro') {
    return { notified: false, reason: 'micro_event' };
  }

  // 3. Retrieve webhook URL from SSM
  let webhookUrl: string;
  try {
    webhookUrl = await getWebhookUrl(ssmClient, input.project_id);
  } catch (err) {
    if (err instanceof SlackServiceError && err.code === 'PROJECT_NOT_FOUND') {
      // Generic error to caller — no SSM path exposed (F-01 §3.1 LOW-8)
      return { notified: false, reason: 'webhook_not_configured' };
    }
    // Unexpected SSM error
    return { notified: false, reason: 'webhook_lookup_failed' };
  }

  // 4. Format message per F-01 §6.2 template
  const slackMessage = `🏁 *[${input.project_id}]* ${input.message}`;

  // 5. POST to Slack
  try {
    await postToSlack(webhookUrl, slackMessage);
    return { notified: true };
  } catch (err) {
    if (err instanceof SlackServiceError) {
      // All Slack errors return { notified: false, reason } — no exception thrown
      return { notified: false, reason: err.code.toLowerCase() };
    }
    // Unexpected error
    return { notified: false, reason: 'slack_error' };
  }
}
```

---

## 4. Integration with `index.ts` — Server Bootstrap

**Change required in `packages/mcp-server/src/index.ts`:**

Update the `registerNotifySlack()` call to pass `ssmClient`:

**Before:**
```typescript
registerNotifySlack(mcpServer, config);
```

**After:**
```typescript
registerNotifySlack(mcpServer, { ssmClient });
```

Where `ssmClient` is the SSMClient already initialized for loading server config.

---

## 5. Error Handling & Observability

### 5.1 Error Response Shape

All errors returned as `NotifySlackOutput` — never thrown as MCP errors:

| Scenario | Response | Logging |
|----------|----------|---------|
| Success (macro) | `{ notified: true }` | INFO: tool call succeeded |
| Micro event | `{ notified: false, reason: 'micro_event' }` | DEBUG: skipped micro |
| SSM param missing | `{ notified: false, reason: 'webhook_not_configured' }` | WARN: SSM path not found (log path internally, not in response) |
| Slack non-2xx | `{ notified: false, reason: 'slack_post_failed' }` | WARN: Slack returned status X |
| Slack timeout | `{ notified: false, reason: 'slack_timeout' }` | WARN: Slack timeout (3s) |
| Network error | `{ notified: false, reason: 'slack_network_error' }` | WARN: network unreachable |

**Key rule (F-01 §3.1 LOW-8):** Error messages are generic — SSM paths never exposed to MCP caller. Full paths logged to CloudWatch for debugging.

### 5.2 Logging

```typescript
// Example log statements (pseudo-code for illustration)
logger.info('notify_slack succeeded', { project_id, event_type });
logger.debug('notify_slack skipped micro event', { project_id });
logger.warn('webhook not found', { project_id }); // No SSM path in log
logger.warn('slack api error', { status: res.statusCode, project_id });
logger.warn('slack timeout', { project_id, timeout_ms: 3000 });
```

---

## 6. Testing Requirements (DoD)

### 6.1 Unit Tests: `slack.service.test.ts`

```typescript
// Test getWebhookUrl
- ✅ Returns cached URL within TTL
- ✅ Fetches from SSM on cache miss
- ✅ Rejects with PROJECT_NOT_FOUND on missing param
- ✅ Cache TTL expires correctly at 5 minutes
- ✅ Throws SlackServiceError, not raw SSM error

// Test postToSlack
- ✅ POSTs to Slack with correct body { text: message }
- ✅ Returns on 2xx status
- ✅ Throws SLACK_POST_FAILED on non-2xx
- ✅ Throws SLACK_TIMEOUT on 3s timeout
- ✅ Throws SLACK_NETWORK_ERROR on ENOTFOUND/ECONNREFUSED
```

**Mocks:**
- SSMClient via `@aws-sdk/client-ssm` mock
- `https.request` via Node native module mock

### 6.2 Integration Tests: `notify-slack.test.ts`

```typescript
// Test tool handler
- ✅ Parses Zod schema correctly
- ✅ Returns { notified: false, reason: 'micro_event' } for micro
- ✅ Returns { notified: true } on success (macro)
- ✅ Returns { notified: false, reason: 'webhook_not_configured' } on SSM miss
- ✅ Returns { notified: false, reason: 'slack_timeout' } on timeout
- ✅ Formats message per F-01 §6.2 template (🏁 *[project]* message)
```

**Mocks:**
- SSMClient (return webhookUrl or throw ParameterNotFound)
- `https.request` (return 200 or timeout)

### 6.3 Build Verification

```bash
npm run build -w packages/mcp-server
# Must pass with zero errors
```

---

## 7. Performance & SLA

| Metric | Target | Design |
|--------|--------|--------|
| p95 latency | < 5s | SSM cached (5-min TTL, ~10ms on cache hit); Slack POST 3s timeout |
| Throughput | >10/sec (POC) | Sequential handler; no concurrency limits |
| Cache hit rate | >95% | 5-min TTL; typical POC ~2-5 events/day per project |

---

## 8. SSM Parameters

| Path | Type | Value | Created By |
|------|------|-------|-----------|
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | Slack incoming webhook URL | Manual (per-project setup) or automation |

**Example setup:**
```bash
aws ssm put-parameter \
  --name /kiro-governance/slack/webhooks/rainn \
  --value "https://hooks.slack.com/services/T1234/B5678/xxxx" \
  --type SecureString \
  --overwrite
```

---

## 9. Definition of Done (DoD)

- ✅ `slack.service.ts` created with `getWebhookUrl()` and `postToSlack()`
  - ✅ SSM GetParameter with 5-min TTL cache
  - ✅ Slack POST via native `https.request` (3s timeout)
  - ✅ SlackServiceError exception class with machine-readable codes
  - ✅ Generic error messages (no SSM paths exposed)

- ✅ `notify-slack.ts` implements MCP tool handler
  - ✅ Zod schema validation
  - ✅ Macro-only check (skip micro, return `{ notified: false, reason: 'micro_event' }`)
  - ✅ SSM lookup with PROJECT_NOT_FOUND handling
  - ✅ Slack POST with message formatting (F-01 §6.2 template)
  - ✅ All errors caught and returned as `NotifySlackOutput`, never thrown

- ✅ `index.ts` updated to pass SSM client to `registerNotifySlack()`

- ✅ Unit tests pass (>80% coverage)
  - ✅ Mock SSMClient
  - ✅ Mock https.request
  - ✅ All error paths tested

- ✅ Integration tests pass
  - ✅ Full tool flow with mocked dependencies
  - ✅ Schema validation errors caught by Zod
  - ✅ Message formatting per F-01 §6.2

- ✅ Build passes: `npm run build -w packages/mcp-server`

- ✅ No hardcoded secrets

- ✅ TypeScript strict mode, no `any`

---

## 10. Traceability

| Requirement | Source | Implemented In |
|-------------|--------|-----------------|
| Webhook URL from SSM | SRS FR-01, OQ-01, OQ-04 | `slack.service.ts`: `getWebhookUrl()` |
| Slack POST | SRS FR-01 | `slack.service.ts`: `postToSlack()` |
| Macro-only | F-01 §3.1 | `notify-slack.ts`: event_type check |
| 3s timeout | F-01 §6.4 | `slack.service.ts`: 3000ms timeout |
| SSM cached 5-min | F-01 §6 | `slack.service.ts`: webhookCache + TTL |
| Generic errors | F-01 §3.1 LOW-8 | `slack.service.ts`: SlackServiceError; no paths exposed |
| Message format | F-01 §6.2 | `notify-slack.ts`: `🏁 *[project]* message` |

---

*End of KG-05 Implementation Spec*
