import https from 'node:https';
import { GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';
/**
 * Custom error class for Slack service errors.
 */
export class SlackServiceError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'SlackServiceError';
    }
}
/**
 * Webhook URL cache with TTL (5 minutes per F-01 §6).
 * Stores (url, expiresAt); updated per-request on cache miss.
 */
const webhookCache = new Map();
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
export async function getWebhookUrl(ssmClient, projectId) {
    const now = Date.now();
    // Check cache
    const cached = webhookCache.get(projectId);
    if (cached && cached.expiresAt > now) {
        return cached.url;
    }
    // Cache miss or expired — fetch from SSM
    try {
        const ssmPath = `/kiro-governance/slack/webhooks/${projectId}`;
        const result = await ssmClient.send(new GetParameterCommand({
            Name: ssmPath,
            WithDecryption: true,
        }));
        const webhookUrl = result.Parameter?.Value;
        if (!webhookUrl) {
            throw new SlackServiceError('PROJECT_NOT_FOUND', 'Webhook not found for project');
        }
        // Cache with 5-min TTL
        const expiresAt = now + 5 * 60 * 1000;
        webhookCache.set(projectId, { url: webhookUrl, expiresAt });
        return webhookUrl;
    }
    catch (err) {
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
 * Timeout: 3 seconds per F-01 §6.4 (p95 target <5s)
 *
 * Throws SlackServiceError with code:
 * - 'SLACK_POST_FAILED': Non-2xx HTTP response
 * - 'SLACK_TIMEOUT': Request exceeded timeout
 * - 'SLACK_NETWORK_ERROR': Network unreachable
 */
export async function postToSlack(webhookUrl, message) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ text: message });
        let req;
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new SlackServiceError('SLACK_TIMEOUT', 'Slack request timed out'));
        }, 3000);
        try {
            req = https.request(webhookUrl, { method: 'POST' }, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk.toString();
                });
                res.on('end', () => {
                    clearTimeout(timeout);
                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        reject(new SlackServiceError('SLACK_POST_FAILED', `Slack returned status ${res.statusCode}`));
                    }
                    else {
                        resolve();
                    }
                });
            });
            req.on('error', (err) => {
                clearTimeout(timeout);
                if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
                    reject(new SlackServiceError('SLACK_NETWORK_ERROR', 'Network unreachable'));
                }
                else {
                    reject(new SlackServiceError('SLACK_POST_FAILED', err.message));
                }
            });
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Content-Length', Buffer.byteLength(body));
            req.write(body);
            req.end();
        }
        catch (err) {
            clearTimeout(timeout);
            reject(new SlackServiceError('SLACK_POST_FAILED', 'Failed to create request'));
        }
    });
}
//# sourceMappingURL=slack.service.js.map