import { SSMClient } from '@aws-sdk/client-ssm';
/**
 * Custom error class for Slack service errors.
 */
export declare class SlackServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
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
export declare function getWebhookUrl(ssmClient: SSMClient, projectId: string): Promise<string>;
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
export declare function postToSlack(webhookUrl: string, message: string): Promise<void>;
//# sourceMappingURL=slack.service.d.ts.map