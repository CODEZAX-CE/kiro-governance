import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Input schema for record_progress tool.
 * Per F-01 §3.2 — exact fields, validation, constraints.
 */
export declare const RecordProgressInputSchema: z.ZodObject<{
    project_id: z.ZodString;
    update_text: z.ZodString;
    type: z.ZodOptional<z.ZodEnum<["macro", "micro"]>>;
    gate: z.ZodOptional<z.ZodString>;
    phase: z.ZodOptional<z.ZodString>;
    source_ref: z.ZodString;
    actor: z.ZodString;
    flag_override: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    update_text: string;
    source_ref: string;
    actor: string;
    project_id: string;
    type?: "macro" | "micro" | undefined;
    flag_override?: boolean | undefined;
    gate?: string | undefined;
    phase?: string | undefined;
}, {
    update_text: string;
    source_ref: string;
    actor: string;
    project_id: string;
    type?: "macro" | "micro" | undefined;
    flag_override?: boolean | undefined;
    gate?: string | undefined;
    phase?: string | undefined;
}>;
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
export declare function registerRecordProgress(server: McpServer, config: {
    tableName: string;
}): void;
//# sourceMappingURL=record-progress.d.ts.map