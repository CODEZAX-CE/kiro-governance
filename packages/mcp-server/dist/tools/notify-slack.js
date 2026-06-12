import { z } from 'zod';
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
/**
 * Register notify_slack MCP tool.
 * Tool is called after record_progress succeeds (macro events only).
 * See F-01 §3.1 for architecture and error handling.
 */
export function registerNotifySlack(server, config) {
    server.tool('notify_slack', 'Send a Slack notification for governance event (macro events only)', NotifySlackInputSchema.shape, async (params) => {
        const result = await handleNotifySlack(params, config.ssmClient);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result),
                },
            ],
        };
    });
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
async function handleNotifySlack(params, ssmClient) {
    // 1. Validate input
    const input = NotifySlackInputSchema.parse(params);
    // 2. Skip if micro event (macro-only per F-01 §3.1)
    if (input.event_type === 'micro') {
        return { notified: false, reason: 'micro_event' };
    }
    // 3. Retrieve webhook URL from SSM
    let webhookUrl;
    try {
        webhookUrl = await getWebhookUrl(ssmClient, input.project_id);
    }
    catch (err) {
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
    }
    catch (err) {
        if (err instanceof SlackServiceError) {
            // All Slack errors return { notified: false, reason } — no exception thrown
            return { notified: false, reason: err.code.toLowerCase() };
        }
        // Unexpected error
        return { notified: false, reason: 'slack_error' };
    }
}
//# sourceMappingURL=notify-slack.js.map