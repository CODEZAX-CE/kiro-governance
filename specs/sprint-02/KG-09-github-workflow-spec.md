# KG-09 Implementation Spec: GitHub Actions Governance Workflow

**Story:** KG-09 — GitHub Actions workflow — diff parse + macro match + MCP call  
**Feature:** F-03 — GitHub Trigger  
**Sprint:** Sprint 2  
**Author:** Backend Developer  
**Date:** 2026-06-11  

---

## Overview

Implement GitHub Actions workflow and accompanying Node.js script to detect `project-progress.md` changes, parse diffs for macro-gate entries, and invoke the MCP server tools (`record_progress` + `notify_slack`) for macro events only.

**Deliverables:**
- `.github/workflows/governance-trigger.yml` — GitHub Actions workflow
- `scripts/governance-trigger.js` — Node.js script for diff parsing and MCP calls

---

## Files to Create

### 1. `.github/workflows/governance-trigger.yml`

**Path:** `.github/workflows/governance-trigger.yml`

**Purpose:** Trigger on push to main with `docs/project-progress.md` in the changeset, then execute the governance script.

**Implementation notes:**
- Trigger: `push` event to `main` branch, path filter `docs/project-progress.md`
- Checkout with `fetch-depth: 2` to enable single-commit diff via `HEAD~1 HEAD`
- Setup Node.js 20 (matches F-01 §2.1)
- Install and build `packages/shared` to generate compiled constants at `dist/constants/macro-gates.js`
- Pass GitHub Actions context (repo name, actor, commit SHA) as environment variables
- Pass MCP endpoint + credentials as GitHub Encrypted Secrets
- Explicit `permissions: contents: read` for least-privilege access

**Key environment variables passed to script:**
- `MCP_SERVER_URL` — HTTPS endpoint of MCP server
- `MCP_API_KEY` — API key for MCP server auth
- `MCP_CERT_FINGERPRINT` — SHA-256 fingerprint for TLS cert pinning
- `PROJECT_ID` — GitHub repository name (from `github.event.repository.name`)
- `ACTOR` — GitHub username of committer
- `SOURCE_REF` — Commit SHA

---

### 2. `scripts/governance-trigger.js`

**Path:** `scripts/governance-trigger.js`  
**Type:** Node.js CommonJS script (not TypeScript — this is compiled at CI and executed directly)

**Logic flow:**
1. Extract environment variables (MCP_SERVER_URL, MCP_API_KEY, PROJECT_ID, ACTOR, SOURCE_REF)
2. Validate required env vars are present; fail fast if missing
3. Run `git diff HEAD~1 HEAD -- docs/project-progress.md` via `child_process.execSync`
4. Parse output: extract lines starting with `+` (but not `+++`), strip leading `+`, trim whitespace
5. For each added line, call `matchGate(line)` to detect macro-gate substring matches
6. Build list of `{line, gate}` tuples for matched entries
7. For each matched entry:
   - Call MCP tool `record_progress` via HTTPS POST with cert pinning
   - If response is `{written: true}`, call `notify_slack`
   - If response is `{written: false, reason: 'duplicate'}`, skip `notify_slack`
   - If MCP call fails, increment failure counter
8. Exit with code 0 if all succeed, 1 if any fail

**Gate matching:**
- Import compiled `MACRO_GATES` and `MACRO_GATE_ALIASES` from `packages/shared/dist/constants/macro-gates.js`
- Case-insensitive substring matching (same algorithm as F-01 §4.2)
- Try aliases first, then canonical gates
- First match wins

**HTTPS/TLS with cert pinning:**
- Use Node.js `https.request()` (not `fetch()`)
- Implement `checkServerIdentity` callback to verify cert SHA-256 fingerprint
- `MCP_CERT_FINGERPRINT` is colon-delimited hex format (e.g., `AA:BB:CC:...`)
- Node.js `cert.fingerprint256` is in same format
- If fingerprint mismatch, throw error → request fails → failure counter increments

**Error handling:**
- If `git diff` fails or returns empty, log and exit with code 0
- If no macro matches found, log and exit with code 0
- If MCP call fails (connection error, non-2xx response, JSON parse error), catch error, log, increment failure counter
- After processing all entries, fail workflow if any failures detected

---

## Detailed Implementation

### Workflow YAML (.github/workflows/governance-trigger.yml)

```yaml
name: Governance Trigger

on:
  push:
    branches: [main]
    paths: ['docs/project-progress.md']

permissions:
  contents: read

jobs:
  governance-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout with history for diff
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install shared package dependencies
        run: npm ci
        working-directory: packages/shared

      - name: Build shared package
        run: npm run build
        working-directory: packages/shared

      - name: Extract diff and process macro gates
        env:
          MCP_SERVER_URL: ${{ secrets.MCP_SERVER_URL }}
          MCP_API_KEY: ${{ secrets.MCP_API_KEY }}
          MCP_CERT_FINGERPRINT: ${{ secrets.MCP_CERT_FINGERPRINT }}
          PROJECT_ID: ${{ github.event.repository.name }}
          ACTOR: ${{ github.actor }}
          SOURCE_REF: ${{ github.sha }}
        run: node scripts/governance-trigger.js
```

**Notes:**
- `fetch-depth: 2` ensures `HEAD~1` is available for diff
- `npm ci` instead of `npm install` for reproducibility
- Explicit env var pass-through to script (no implicit GitHub context)
- Script path is relative to repository root

---

### Node.js Script (scripts/governance-trigger.js)

```javascript
#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const https = require('https');
const path = require('path');

// Load shared constants from compiled output
let MACRO_GATES, MACRO_GATE_ALIASES;
try {
  const shared = require(path.resolve(__dirname, '../packages/shared/dist/constants/macro-gates'));
  MACRO_GATES = shared.MACRO_GATES;
  MACRO_GATE_ALIASES = shared.MACRO_GATE_ALIASES;
} catch (err) {
  console.error(`Failed to load shared constants: ${err.message}`);
  process.exit(1);
}

// Environment variables
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;
const MCP_CERT_FINGERPRINT = process.env.MCP_CERT_FINGERPRINT;
const PROJECT_ID = process.env.PROJECT_ID;
const ACTOR = process.env.ACTOR;
const SOURCE_REF = process.env.SOURCE_REF;

// Validate required env vars
if (!MCP_SERVER_URL || !MCP_API_KEY || !MCP_CERT_FINGERPRINT || !PROJECT_ID || !ACTOR || !SOURCE_REF) {
  console.error(
    'Missing required environment variables: ' +
    'MCP_SERVER_URL, MCP_API_KEY, MCP_CERT_FINGERPRINT, PROJECT_ID, ACTOR, SOURCE_REF'
  );
  process.exit(1);
}

/**
 * Extract added lines from git diff.
 * Returns array of trimmed strings (+ prefix already removed).
 */
function extractAddedLines() {
  try {
    const diff = execSync('git diff HEAD~1 HEAD -- docs/project-progress.md', { encoding: 'utf8' });
    return diff
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1).trim())
      .filter(line => line.length > 0);
  } catch (err) {
    console.log('No diff available or file does not exist. Exiting cleanly.');
    return [];
  }
}

/**
 * Match a line against macro gates using case-insensitive substring.
 * Returns canonical gate name or null.
 */
function matchGate(line) {
  const lower = line.toLowerCase();

  // Try canonical gates first
  for (const gate of MACRO_GATES) {
    if (lower.includes(gate.toLowerCase())) {
      return gate;
    }
  }

  // Try aliases
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) {
      return canonical;
    }
  }

  return null;
}

/**
 * Call MCP server tool via HTTPS with cert fingerprint pinning.
 * Returns parsed JSON response.
 */
function callMcpTool(toolName, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(MCP_SERVER_URL);
    const host = urlObj.hostname;
    const port = urlObj.port || 443;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: params },
      id: `${toolName}-${Date.now()}`,
    });

    const req = https.request(
      {
        host,
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': MCP_API_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
        checkServerIdentity: (_host, cert) => {
          const actual = cert.fingerprint256;
          if (actual !== MCP_CERT_FINGERPRINT) {
            return new Error(
              `TLS cert fingerprint mismatch: expected ${MCP_CERT_FINGERPRINT}, got ${actual}`
            );
          }
          return undefined; // OK
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Failed to parse MCP response: ${err.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const addedLines = extractAddedLines();

  if (addedLines.length === 0) {
    console.log('No new lines in project-progress.md. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${addedLines.length} added line(s).`);

  // Extract macro entries
  const macroEntries = [];
  for (const line of addedLines) {
    const gate = matchGate(line);
    if (gate) {
      macroEntries.push({ line, gate });
    }
  }

  if (macroEntries.length === 0) {
    console.log('No macro-gate entries detected. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${macroEntries.length} macro-gate entries.`);

  let failures = 0;

  // Process each macro entry
  for (const { line, gate } of macroEntries) {
    console.log(`Processing gate: "${gate}" from line: "${line}"`);

    try {
      // Call record_progress
      const recordResult = await callMcpTool('record_progress', {
        project_id: PROJECT_ID,
        update_text: line,
        type: 'macro',
        gate,
        source_ref: SOURCE_REF,
        actor: ACTOR,
      });

      const content = recordResult?.result?.content?.[0]?.text;
      const parsed = content ? JSON.parse(content) : {};

      if (parsed.written === false) {
        console.log(`  → Duplicate (already recorded). Skipping notify_slack.`);
        continue;
      }

      // Call notify_slack only if record_progress succeeded
      const shortSha = SOURCE_REF.slice(0, 7);
      await callMcpTool('notify_slack', {
        project_id: PROJECT_ID,
        message: `${gate} — committed by ${ACTOR} (ref: ${shortSha})`,
        event_type: 'macro',
      });

      console.log(`  → Recorded and notified.`);
    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`${failures} MCP call(s) failed.`);
    process.exit(1);
  }

  console.log('All macro entries processed successfully.');
  process.exit(0);
}

main().catch(err => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
```

**Key implementation details:**

1. **Imports:** Uses CommonJS `require()` to load compiled shared constants from `packages/shared/dist/constants/macro-gates.js`
2. **Env validation:** Fails fast if any required variable is missing
3. **Git diff:** Runs `git diff HEAD~1 HEAD -- docs/project-progress.md`, handles errors gracefully
4. **Line extraction:** Filters for `+` lines (added), skips `+++` (metadata), strips prefix, trims whitespace
5. **Gate matching:** Case-insensitive substring, tries canonical gates then aliases, first match wins
6. **HTTPS with pinning:** Uses `https.request()` with `checkServerIdentity` callback to verify SHA-256 fingerprint
7. **MCP tool calls:** JSON-RPC 2.0 format, includes `X-API-Key` header, parses response
8. **Dedup handling:** If `written: false` (duplicate), skips `notify_slack` and continues
9. **Error handling:** Catches all errors, increments failure counter, exits with code 1 if any failures
10. **Exit codes:** 0 for clean exit (no entries, all success), 1 for failures

---

## Definition of Done Checklist

- [x] Workflow YAML is syntactically valid (no YAML errors)
- [x] Workflow triggers only on `push` to `main` with path filter `docs/project-progress.md`
- [x] Workflow uses `fetch-depth: 2` for single-commit diff
- [x] Workflow has explicit `permissions: contents: read`
- [x] Workflow installs and builds `packages/shared` before running script
- [x] Script imports `MACRO_GATES` and `MACRO_GATE_ALIASES` from compiled shared constants
- [x] Script uses `git diff HEAD~1 HEAD -- docs/project-progress.md` for diff extraction
- [x] Script extracts added lines (lines starting with `+`, not `+++`), strips prefix, trims whitespace
- [x] Script implements case-insensitive substring matching for gate names
- [x] Script tries canonical gates first, then aliases (same algorithm as F-01 §4.2)
- [x] Script calls `record_progress` with correct parameters: project_id, update_text, type: 'macro', gate, source_ref, actor
- [x] Script calls `notify_slack` only if `record_progress` returns `written: true` (not on duplicates)
- [x] Script uses `https.request()` with `checkServerIdentity` callback for TLS cert fingerprint pinning
- [x] Script validates `MCP_CERT_FINGERPRINT` matches `cert.fingerprint256` from server cert
- [x] Script includes `X-API-Key` header in all MCP requests
- [x] Script exits with code 0 if no entries/matches/successes (clean exit)
- [x] Script exits with code 1 if any MCP call fails (visible workflow failure)
- [x] Script handles edge cases: no diff, no matches, MCP errors, duplicate records
- [x] Non-macro lines (those that don't match any gate) are silently ignored
- [x] GitHub Actions secrets are used for `MCP_SERVER_URL`, `MCP_API_KEY`, `MCP_CERT_FINGERPRINT`

---

## Environment Variables (GitHub Actions Secrets)

| Secret Name | Example Value | Source |
|-------------|---------------|--------|
| `MCP_SERVER_URL` | `https://1.2.3.4:443/mcp` | F-03 §4.5 — EC2 Elastic IP + port |
| `MCP_API_KEY` | `(secret)` | F-03 §4.5 — Must match SSM `/kiro-governance/config/mcp-api-key` |
| `MCP_CERT_FINGERPRINT` | `AA:BB:CC:...:ZZ` | F-03 §4.5 — SHA-256 fingerprint of MCP server cert (Node.js colon-delimited hex format) |

These secrets must be configured in GitHub repository settings before the workflow can run.

---

## References

- **F-03 Architecture:** `docs/phase1/github-trigger-architecture.md` v1.3 (§2, §3, §4)
- **F-01 Architecture:** `docs/phase1/mcp-server-core-architecture.md` v1.1 (gate matching algorithm, MCP tool schemas)
- **Shared Constants:** `packages/shared/constants/macro-gates.ts` (MACRO_GATES, MACRO_GATE_ALIASES)
- **SRS Requirements:** SRS §8 FR-04 (GitHub Actions workflow for `project-progress.md` diffs)
- **Code Structure:** `docs/code-structure.md` §5.2 (monorepo imports of shared constants)

---

## Security Notes

1. **Cert fingerprint pinning:** Uses `checkServerIdentity` callback in `https.request()` to verify SHA-256 fingerprint, preventing man-in-the-middle attacks
2. **API key authentication:** All MCP calls include `X-API-Key` header for authentication
3. **Least-privilege workflow permissions:** Explicit `permissions: contents: read` prevents access to other repository features
4. **Secret handling:** All sensitive values (API key, server URL, cert fingerprint) are GitHub Encrypted Secrets, not workflow variables
5. **No hardcoded credentials:** All configuration via environment variables from GitHub Actions secrets

---

## Testing

After implementation, verify:

1. **Trigger:** Push a commit to `main` that modifies `docs/project-progress.md` and verify workflow runs
2. **Diff parsing:** Add lines containing macro-gate keywords (e.g., "SRS approved") and verify they are extracted
3. **Gate matching:** Verify case-insensitive matching works (e.g., "srs approved" → matches "SRS approved")
4. **MCP calls:** Verify `record_progress` and `notify_slack` are called with correct parameters
5. **Dedup:** Push two commits with the same gate entry on the same day; verify second is dedup'd
6. **Non-macro lines:** Add lines without gate keywords and verify they don't trigger MCP calls
7. **Failure handling:** Temporarily misconfigure MCP_API_KEY and verify workflow fails visibly

---

*End of KG-09 Implementation Spec*
