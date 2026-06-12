import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSMClient } from '@aws-sdk/client-ssm';
/**
 * Input schema for notify_slack tool.
 * Per F-01 §3.1 — exact fields required by specification.
 */
export declare const NotifySlackInputSchema: z.ZodObject<{
    project_id: z.ZodString;
    message: z.ZodString;
    event_type: z.ZodEnum<["macro", "micro"]>;
}, "strip", z.ZodTypeAny, {
    project_id: string;
    message: string;
    event_type: "macro" | "micro";
}, {
    project_id: string;
    message: string;
    event_type: "macro" | "micro";
}>;
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
export declare function registerNotifySlack(server: McpServer, config: {
    ssmClient: SSMClient;
}): void;
//# sourceMappingURL=notify-slack.d.ts.map