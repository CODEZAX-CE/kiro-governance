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
