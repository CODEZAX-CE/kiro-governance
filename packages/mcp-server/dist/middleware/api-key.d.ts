import { IncomingMessage, ServerResponse } from 'node:http';
/**
 * Validate X-API-Key header against expected API key.
 * Returns true if valid and request should proceed.
 * Returns false if invalid — middleware already sent 401 response.
 * Per F-01 §7.1 — missing or invalid key → HTTP 401 immediately.
 */
export declare function validateApiKey(req: IncomingMessage, res: ServerResponse, expectedKey: string): boolean;
//# sourceMappingURL=api-key.d.ts.map