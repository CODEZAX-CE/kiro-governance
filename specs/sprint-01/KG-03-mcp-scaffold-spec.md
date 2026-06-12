# KG-03: MCP Server Project Scaffold — Implementation Spec

**Story:** KG-03 — MCP Server project scaffold (Node.js/TypeScript, MCP SDK, HTTPS/TLS, API key middleware, systemd)
**Sprint:** 1 | **Points:** 3 | **Dependencies:** KG-02
**Status:** READY FOR IMPLEMENTATION

---

## 1. Overview

This story creates the minimal Node.js/TypeScript scaffold for the MCP server that will host the `record_progress` and `notify_slack` tools (implemented in KG-04 and KG-05). The server runs on EC2 (already set up in KG-02), listens on port 443 with HTTPS/SSE, validates requests via `X-API-Key` header, and registers tool handlers (stubs only).

**Scope:**
- Project structure: `packages/mcp-server/` with `package.json`, `tsconfig.json`
- Server entry point: `src/index.ts` — HTTPS server bootstrap, tool registration, config loading
- Middleware: `src/middleware/api-key.ts` — request validation
- Tool stubs: `src/tools/record-progress.ts` and `src/tools/notify-slack.ts` (return `{ ok: true }`)
- Systemd unit: `scripts/kiro-mcp-server.service`

**Out of Scope:**
- Tool implementation (KG-04, KG-05)
- DynamoDB/Slack service logic (KG-04, KG-05)

---

## 2. Acceptance Criteria & Verification

| AC | Description | Verification |
|----|----|------|
| **AC-01** | TypeScript project initialized with strict mode, Node.js 20 LTS as target | `npm run build -w packages/mcp-server` succeeds with zero errors; `tsconfig.json` has `strict: true` |
| **AC-02** | `@modelcontextprotocol/sdk` dependency installed; MCP server listens on port 443 | Review `package.json` for `@modelcontextprotocol/sdk`; inspect `index.ts` listen call |
| **AC-03** | HTTPS/TLS configured using cert/key from `TLS_CERT_PATH` and `TLS_KEY_PATH` env vars | Review `index.ts` `https.createServer()` with file reads; start server and `curl -k https://localhost:443/health` returns JSON |
| **AC-04** | MCP endpoint at `POST /mcp` with `StreamableHTTPServerTransport` | Review MCP setup in `index.ts`; verify with MCP client test (curl-based or Node.js) |
| **AC-05** | API key validation middleware: X-API-Key header checked against env var `MCP_API_KEY` | Review `api-key.ts`; test: `curl -k https://localhost:443/health` (no key required, returns 200); `curl -k -H 'X-API-Key: wrong' https://localhost:443/mcp` returns 401 with `{ error: 'Unauthorized', code: 'INVALID_API_KEY' }` |
| **AC-06** | `GET /health` endpoint returns `{ status: 'ok', uptime: <seconds> }` without requiring API key | Test: `curl -k https://localhost:443/health` returns 200 |
| **AC-07** | `record_progress` and `notify_slack` tools registered as stubs; each returns tool result JSON | MCP client test calling tool → returns `{ ok: true }` |
| **AC-08** | Server startup loads config from SSM (table-name, region, api-key) and caches in memory | Review `index.ts` bootstrap: SSM GetParameter calls for 3 paths; caching logic in `ServerConfig` object; log "Loaded config from SSM" |
| **AC-09** | systemd service file created with correct environment, restart policy, `AmbientCapabilities=CAP_NET_BIND_SERVICE` | Review `scripts/kiro-mcp-server.service`; verify syntax with `systemd-analyze verify` |
| **AC-10** | `package.json` scripts: `build` (tsc), `start` (node dist/index.js), `dev` (ts-node src/index.ts) | Review `package.json` scripts section |
| **AC-11** | Zero TypeScript errors in strict mode; no `any` types | Run `npm run build -w packages/mcp-server` and verify zero errors; grep for `: any` |
| **AC-12** | CloudWatch structured JSON logging enabled | Review `index.ts` logger setup; sample log: `{ timestamp, level, msg, tool?, project_id?, duration_ms? }` |

---

## 3. Files to Create

### 3.1 `packages/mcp-server/package.json`

```json
{
  "name": "@kiro-governance/mcp-server",
  "version": "1.0.0",
  "private": true,
  "description": "MCP server for Kiro governance tracking",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@aws-sdk/client-dynamodb": "^3.600.0",
    "@aws-sdk/client-ssm": "^3.600.0",
    "@aws-sdk/util-dynamodb": "^3.600.0",
    "zod": "^3.23.8",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0"
  }
}
```

**Rationale:**
- `@modelcontextprotocol/sdk` — official MCP TypeScript SDK for remote server with HTTP/SSE transport
- `@aws-sdk/*` — AWS clients (DynamoDB, SSM) for KG-04/05; installed now to avoid workspace conflict later
- `zod` — schema validation for tool inputs
- `ulid` — ULID generation for event sort keys (deterministic in tests, distributed uniqueness)
- `type: "module"` — ES modules (Node.js 20 native)

---

### 3.2 `packages/mcp-server/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2020"],
    "module": "ES2020",
    "target": "ES2020",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "paths": {
      "@kiro-governance/shared/*": ["../../packages/shared/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Rationale:**
- Strict mode enforced (all flags enabled)
- ES2020 target (native async/await, null coalescing)
- Path alias for shared imports
- Extends root `tsconfig.base.json` for workspace consistency

---

### 3.3 `packages/mcp-server/src/index.ts`

```typescript
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { validateApiKey } from './middleware/api-key.js';
import { registerRecordProgress } from './tools/record-progress.js';
import { registerNotifySlack } from './tools/notify-slack.js';

/**
 * Server configuration loaded from SSM and cached at startup.
 */
interface ServerConfig {
  tableName: string;
  region: string;
  apiKey: string;
}

/**
 * MCP server bootstrap.
 * Loads TLS cert/key, config from SSM, creates HTTPS server,
 * registers MCP tools, and listens on port 443.
 */
async function bootstrap(): Promise<void> {
  // 1. Validate required environment variables (fail fast)
  const requiredEnvs = ['TLS_CERT_PATH', 'TLS_KEY_PATH', 'AWS_REGION', 'PORT'];
  const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
  if (missingEnvs.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvs.join(', ')}`);
  }

  const port = parseInt(process.env.PORT || '443', 10);
  const tlsCertPath = process.env.TLS_CERT_PATH!;
  const tlsKeyPath = process.env.TLS_KEY_PATH!;

  // 2. Load TLS certificate and key
  let tlsCert: Buffer;
  let tlsKey: Buffer;
  try {
    tlsCert = readFileSync(tlsCertPath);
    tlsKey = readFileSync(tlsKeyPath);
  } catch (err) {
    throw new Error(`Failed to read TLS cert/key: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Load config from SSM (cache in memory)
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
  const config = await loadServerConfig(ssmClient);
  console.info('Loaded config from SSM', {
    tableName: config.tableName,
    region: config.region,
  });

  // 4. Create HTTPS server with TLS config
  const httpsServer = https.createServer({
    cert: tlsCert,
    key: tlsKey,
  });

  // 5. Create MCP server instance
  const mcpServer = new McpServer({
    name: 'kiro-governance',
    version: '1.0.0',
  });

  // 6. Register MCP tools (stubs for now)
  registerRecordProgress(mcpServer, config);
  registerNotifySlack(mcpServer, config);

  // 7. Attach HTTP routing
  httpsServer.on('request', (req, res) => {
    // Health check endpoint (no API key required)
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    // MCP endpoint with API key validation
    if (req.url === '/mcp' && req.method === 'POST') {
      if (!validateApiKey(req, res, config.apiKey)) {
        return; // Middleware already sent 401
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      mcpServer.connect(transport).then(() => {
        return transport.handleRequest(req, res, req.body);
      }).catch(err => {
        console.error('MCP transport error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error', code: 'INTERNAL_ERROR' }));
      });
      return;
    }

    // 404 for unknown endpoints
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }));
  });

  // 8. Start server
  httpsServer.listen(port, () => {
    console.info(`kiro-governance MCP server listening on :${port}`);
  });
}

/**
 * Load server config from SSM Parameter Store.
 * Caches values in memory — no per-request fetches.
 */
async function loadServerConfig(ssmClient: SSMClient): Promise<ServerConfig> {
  const [tableNameParam, regionParam, apiKeyParam] = await Promise.all([
    ssmClient.send(
      new GetParameterCommand({
        Name: '/kiro-governance/config/table-name',
        WithDecryption: false,
      }),
    ),
    ssmClient.send(
      new GetParameterCommand({
        Name: '/kiro-governance/config/region',
        WithDecryption: false,
      }),
    ),
    ssmClient.send(
      new GetParameterCommand({
        Name: '/kiro-governance/config/mcp-api-key',
        WithDecryption: true,
      }),
    ),
  ]);

  return {
    tableName: tableNameParam.Parameter?.Value || '',
    region: regionParam.Parameter?.Value || '',
    apiKey: apiKeyParam.Parameter?.Value || '',
  };
}

// Run bootstrap
bootstrap().catch(err => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
```

**Key Design Decisions:**

1. **Fail fast on env vars** — bootstrap throws if required vars are missing
2. **TLS files read at startup** — not fetched per-request (immutable after server creation)
3. **SSM config cached** — loaded once, stored in `ServerConfig` object passed to tools
4. **HTTP request router** — manual routing for `/health`, `/mcp`, 404 fallback (placeholder for transport integration in KG-04/05)
5. **Logging** — structured JSON with `console.info` (CloudWatch parses automatically)
6. **API key passed to tools** — `config` object includes `apiKey` for validation in middleware

---

### 3.4 `packages/mcp-server/src/middleware/api-key.ts`

```typescript
import { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Validate X-API-Key header against expected API key.
 * Returns true if valid and request should proceed.
 * Returns false if invalid — middleware already sent 401 response.
 * Per F-01 §7.1 — missing or invalid key → HTTP 401 immediately.
 */
export function validateApiKey(
  req: IncomingMessage,
  res: ServerResponse,
  expectedKey: string,
): boolean {
  const provided = req.headers['x-api-key'];

  if (!provided || provided !== expectedKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', code: 'INVALID_API_KEY' }));
    return false;
  }

  return true;
}
```

**Design:**
- Synchronous comparison (no async I/O)
- Returns boolean for clarity in HTTP router
- Sends 401 response and ends request on failure (no caller responsibility)
- Error shape matches F-01 §9 spec

---

### 3.5 `packages/mcp-server/src/tools/record-progress.ts`

```typescript
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Input schema for record_progress tool.
 * Per F-01 §3.2 — exact fields, validation, constraints.
 */
export const RecordProgressInputSchema = z.object({
  project_id: z.string().min(1),
  update_text: z.string().min(1).max(4096),
  type: z.enum(['macro', 'micro']).optional(),
  gate: z.string().optional(),
  phase: z.string().optional(),
  source_ref: z.string().min(1),
  actor: z.string().min(1),
  flag_override: z.boolean().optional(),
});

export type RecordProgressInput = z.infer<typeof RecordProgressInputSchema>;

/**
 * Output interface for record_progress tool.
 */
export interface RecordProgressOutput {
  ok: boolean;
}

/**
 * Register record_progress MCP tool (stub — real implementation in KG-04).
 * Per code-structure.md §3 — register on McpServer with schema validation.
 */
export function registerRecordProgress(
  server: McpServer,
  _config: Record<string, unknown>, // Placeholder for ServerConfig from index.ts
): void {
  server.tool(
    'record_progress',
    'Write a governance event to DynamoDB with auto-classification and deduplication',
    {
      project_id: { type: 'string', description: 'GitHub repository name' },
      update_text: { type: 'string', description: 'Event description' },
      type: { type: 'string', enum: ['macro', 'micro'], description: 'Event type (optional)' },
      gate: { type: 'string', description: 'Canonical gate name (optional)' },
      phase: { type: 'string', description: 'Phase grouping (optional)' },
      source_ref: { type: 'string', description: 'Commit SHA or file reference' },
      actor: { type: 'string', description: 'Who approved' },
      flag_override: { type: 'boolean', description: 'Manual override flag (optional)' },
    },
    async (params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> => {
      // Validate input with Zod
      const input = RecordProgressInputSchema.parse(params);

      // Stub: return { ok: true }
      // Real implementation: classification + dedup + DynamoDB write (KG-04)
      console.info('record_progress called', { project_id: input.project_id });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ written: true, pk: 'PROJECT#stub', sk: 'UPDATE#stub' }),
          },
        ],
      };
    },
  );
}
```

**Design:**
- Zod schema at module level for reuse and clarity
- Tool handler validates input before business logic runs
- Output wrapped in MCP text content envelope (per MCP SDK spec)
- Comment references KG-04 for real implementation
- Stub returns success for testing in KG-03 verification

---

### 3.6 `packages/mcp-server/src/tools/notify-slack.ts`

```typescript
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Input schema for notify_slack tool.
 * Per F-01 §3.1 — exact fields, validation.
 */
export const NotifySlackInputSchema = z.object({
  project_id: z.string().min(1),
  message: z.string().min(1),
  event_type: z.enum(['macro', 'micro']),
});

export type NotifySlackInput = z.infer<typeof NotifySlackInputSchema>;

/**
 * Output interface for notify_slack tool.
 */
export interface NotifySlackOutput {
  ok: boolean;
}

/**
 * Register notify_slack MCP tool (stub — real implementation in KG-05).
 * Per code-structure.md §3 — register on McpServer with schema validation.
 */
export function registerNotifySlack(
  server: McpServer,
  _config: Record<string, unknown>, // Placeholder for ServerConfig from index.ts
): void {
  server.tool(
    'notify_slack',
    'Send a Slack notification for macro events',
    {
      project_id: { type: 'string', description: 'GitHub repository name' },
      message: { type: 'string', description: 'Notification message' },
      event_type: { type: 'string', enum: ['macro', 'micro'], description: 'Event type' },
    },
    async (params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> => {
      // Validate input with Zod
      const input = NotifySlackInputSchema.parse(params);

      // Stub: return { ok: true }
      // Real implementation: SSM lookup + Slack POST (KG-05)
      console.info('notify_slack called', { project_id: input.project_id, event_type: input.event_type });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ notified: true }),
          },
        ],
      };
    },
  );
}
```

**Design:**
- Mirrors `record-progress.ts` structure for consistency
- Stub validates input and logs call
- Real implementation will follow Slack API pattern (KG-05)

---

### 3.7 `scripts/kiro-mcp-server.service`

```ini
[Unit]
Description=kiro-governance MCP Server
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/kiro-governance
ExecStart=/usr/bin/node /opt/kiro-governance/dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=443
Environment=TLS_CERT_PATH=/opt/kiro-governance/cert.pem
Environment=TLS_KEY_PATH=/opt/kiro-governance/key.pem
Environment=LOG_LEVEL=info
EnvironmentFile=/opt/kiro-governance/.env
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

**Design:**
- `Type=simple` — process runs in foreground (Node.js naturally)
- `Restart=on-failure`, `RestartSec=5` — auto-recovery on crash
- `AmbientCapabilities=CAP_NET_BIND_SERVICE` — bind to port 443 without root (per F-01 §2.3)
- `EnvironmentFile` — loads secrets from `.env` (sourced from SSM at EC2 startup)
- Environment variables set inline for non-secrets

---

### 3.8 Root Workspace Updates

**`/Users/ce-it-faraz/Desktop/CODE/kiro-governance/package.json` (update workspaces array)**

```json
{
  "workspaces": ["packages/*", "infra"]
}
```

Ensure `packages/mcp-server` is included in workspaces (should already be if folder exists).

---

## 4. Definition of Done Checklist

- [ ] `packages/mcp-server/package.json` created with correct dependencies
- [ ] `packages/mcp-server/tsconfig.json` created with strict mode enabled
- [ ] `packages/mcp-server/src/index.ts` created with bootstrap sequence (§3 of F-01 v1.2)
  - [ ] Fail-fast on missing env vars
  - [ ] TLS cert/key loaded from filesystem
  - [ ] SSM config loaded and cached
  - [ ] HTTPS server created on port 443
  - [ ] MCP tools registered (stubs)
  - [ ] HTTP router with `/health` (no auth), `/mcp` (with API key validation), 404 fallback
  - [ ] Startup log: "kiro-governance MCP server listening on :443"
- [ ] `packages/mcp-server/src/middleware/api-key.ts` created with X-API-Key validation
- [ ] `packages/mcp-server/src/tools/record-progress.ts` created (stub with Zod schema)
- [ ] `packages/mcp-server/src/tools/notify-slack.ts` created (stub with Zod schema)
- [ ] `scripts/kiro-mcp-server.service` created with systemd config
- [ ] `npm run build -w packages/mcp-server` succeeds with zero TypeScript errors
- [ ] No `any` types present in source (verify with grep)
- [ ] Server runs with `node dist/index.js` when `.env` or SSM mocked
- [ ] `curl -k https://localhost:443/health` returns `{ status: 'ok', uptime: <seconds> }`
- [ ] `curl -k -H 'X-API-Key: test' https://localhost:443/health` returns 200
- [ ] `curl -k -X POST https://localhost:443/mcp` returns 401 (missing API key)
- [ ] `curl -k -X POST -H 'X-API-Key: test' https://localhost:443/mcp` returns 404 (placeholder response)
- [ ] `curl -k https://localhost:443/unknown` returns 404

---

## 5. Local Testing Guide

### 5.1 Prerequisites

```bash
cd /Users/ce-it-faraz/Desktop/CODE/kiro-governance
npm ci
npm run build -w packages/shared
```

### 5.2 Generate Self-Signed Certificate (Local Dev)

```bash
mkdir -p /tmp/kiro-test
openssl req -x509 -newkey rsa:2048 -keyout /tmp/kiro-test/key.pem -out /tmp/kiro-test/cert.pem \
  -days 30 -nodes -subj "/CN=localhost"
```

### 5.3 Create `.env.test` in `packages/mcp-server/`

```bash
export MCP_API_KEY="test-key-12345"
export TLS_CERT_PATH="/tmp/kiro-test/cert.pem"
export TLS_KEY_PATH="/tmp/kiro-test/key.pem"
export TABLE_NAME="kiro-governance-tracker"
export AWS_REGION="us-east-1"
export PORT="443"
```

### 5.4 Run Dev Server

```bash
cd packages/mcp-server
source .env.test
npm run dev
```

Expected output:
```
Loaded config from SSM...
kiro-governance MCP server listening on :443
```

### 5.5 Test Endpoints

**Health check (no auth required):**
```bash
curl -k https://localhost:443/health
# Expected: { "status": "ok", "uptime": 3.14 }
```

**MCP endpoint without API key:**
```bash
curl -k -X POST https://localhost:443/mcp
# Expected: 401 { "error": "Unauthorized", "code": "INVALID_API_KEY" }
```

**MCP endpoint with valid API key:**
```bash
curl -k -X POST -H 'X-API-Key: test-key-12345' https://localhost:443/mcp
# Expected: 404 { "error": "Not found", "code": "NOT_FOUND" } (placeholder response)
```

**Unknown endpoint:**
```bash
curl -k https://localhost:443/unknown
# Expected: 404 { "error": "Not found", "code": "NOT_FOUND" }
```

---

## 6. Dependencies & Import Paths

### 6.1 Package Dependencies Summary

| Package | Version | Used By | Purpose |
|---------|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `^1.0.0` | `index.ts` | MCP server framework |
| `zod` | `^3.23.8` | `tools/*.ts` | Input schema validation |
| `@aws-sdk/client-ssm` | `^3.600.0` | `index.ts` (bootstrap) | Load config from SSM Parameter Store |
| `@aws-sdk/client-dynamodb` | `^3.600.0` | Will use in KG-04 | DynamoDB client (install now to avoid workspace issues) |
| `@aws-sdk/util-dynamodb` | `^3.600.0` | Will use in KG-04 | Marshall/unmarshall helpers |
| `ulid` | `^2.3.0` | Will use in KG-04 | ULID generation |

### 6.2 Import Paths (ES Module)

All imports use `.js` file extensions for ES module compatibility:

```typescript
// ✅ Correct
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateApiKey } from './middleware/api-key.js';

// ❌ Wrong (will fail)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
```

---

## 7. Build Output & Deployment

### 7.1 Build Output Structure

After `npm run build`:
```
packages/mcp-server/
├── dist/
│   ├── index.js
│   ├── index.d.ts
│   ├── middleware/
│   │   ├── api-key.js
│   │   └── api-key.d.ts
│   ├── tools/
│   │   ├── record-progress.js
│   │   ├── record-progress.d.ts
│   │   ├── notify-slack.js
│   │   └── notify-slack.d.ts
│   ├── index.js.map
│   └── ...
└── src/
    └── ...
```

### 7.2 EC2 Deployment (Manual for KG-03 Testing)

```bash
# On EC2 instance
cd /opt/kiro-governance
git pull origin main
npm ci
npm run build

# Test with systemd
sudo systemctl start kiro-mcp-server
sudo journalctl -u kiro-mcp-server -f

# Verify
curl -k -H 'X-API-Key: <api-key-from-ssm>' https://localhost:443/health
```

---

## 8. Acceptance Criteria Mapping

| AC# | Requirement | File(s) | How to Verify |
|-----|-------------|---------|---|
| AC-01 | TypeScript strict mode | `tsconfig.json` | All `strict: true` flags; `npm run build` zero errors |
| AC-02 | MCP SDK installed, port 443 | `package.json`, `index.ts` | Grep for `@modelcontextprotocol/sdk`; check `httpsServer.listen(443)` |
| AC-03 | HTTPS/TLS from env vars | `index.ts` | Review `readFileSync(tlsCertPath)` and `https.createServer({ cert, key })` |
| AC-04 | MCP endpoint at `/mcp` | `index.ts`, tools | HTTP router checks `url === '/mcp'`; tool registration calls |
| AC-05 | API key validation, 401 on fail | `api-key.ts`, `index.ts` | Compare header against env var; return 401 if mismatch |
| AC-06 | `/health` no auth | `index.ts` | No auth check before health response |
| AC-07 | Tool stubs registered | `tools/*.ts` | Tool functions exported and called in `index.ts` |
| AC-08 | SSM config load + cache | `index.ts` | `loadServerConfig()` fetches 3 params; passed to tools in `config` object |
| AC-09 | systemd service | `scripts/kiro-mcp-server.service` | Valid INI syntax; includes `AmbientCapabilities`, `Restart=on-failure` |
| AC-10 | `package.json` scripts | `package.json` | `build`: `tsc`, `start`: `node dist/index.js`, `dev`: `ts-node src/index.ts` |
| AC-11 | Zero TS errors, no `any` | All `.ts` files | `npm run build` passes; grep for `: any` returns 0 results |
| AC-12 | Structured JSON logging | `index.ts` | Console calls use `console.info()` with object shape: `{ level, msg, ... }` |

---

## 9. Known Limitations (KG-03 → Future Stories)

| Limitation | Why | Resolution In |
|-----------|-----|---|
| Tool handlers return stubs | Business logic not implemented yet | KG-04 (record_progress), KG-05 (notify_slack) |
| `/mcp` endpoint returns 404 | MCP transport not wired yet | KG-04/05 (after tool implementations) |
| No DynamoDB writes | Service layer not implemented | KG-04 |
| No Slack POSTs | Service layer not implemented | KG-05 |
| No auth on specific endpoints (only health is public) | Acceptable for POC — all callers are internal | Production: implement token-based auth |
| SSM read on startup may fail if params missing | Expected — bootstraps after KG-01 (CDK stack creates params) | KG-01 must run first |

---

## 10. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|---|
| **MCP SDK API mismatch** | Medium | High | Read SDK docs + test stubs locally before KG-04 |
| **Port 443 already bound** | Low | Medium | Use `lsof -i :443` to debug; test on local machine first |
| **TLS cert file not found at startup** | Low | High | Fail-fast in bootstrap; clear error message logged |
| **SSM params missing at startup** | Medium | High | KG-01 must deploy first; document in runbook |
| **Node.js ES module import errors** | Medium | High | Always include `.js` extensions in imports; test build locally |
| **`AmbientCapabilities` not effective** | Low | Medium | Test systemd unit on EC2; may need manual CAP_NET_BIND_SERVICE grant |

---

## 11. Handoff Notes for Next Stories

### For KG-04 (record_progress Implementation)

- **Real handler** replaces stub in `src/tools/record-progress.ts`
- **Depends on:** `classifyEvent()` from `packages/shared/constants/macro-gates.ts` (already exists)
- **Depends on:** `GovernanceEventRecord` type from `packages/shared/types/governance-event.ts` (already exists)
- **Service layer:** Create `src/services/dynamodb.service.ts` for conditional PutItem dedup pattern
- **MCP transport:** Wire up `StreamableHTTPServerTransport` in `index.ts` after tool handlers are ready

### For KG-05 (notify_slack Implementation)

- **Real handler** replaces stub in `src/tools/notify-slack.ts`
- **Service layer:** Create `src/services/slack.service.ts` for webhook POST + SSM lookup
- **Cache:** Add webhook URL cache with 5-minute TTL (shared object or utility)

### For KG-03 Code Review

- Check all imports include `.js` extensions
- Verify no `any` types
- Confirm strict TypeScript compilation
- Test locally with cert generation script

---

*End of KG-03 Implementation Spec*
