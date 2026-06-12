/**
 * Canonical macro gate names — single source of truth for gate string comparisons.
 * Must import from here — never hardcode gate strings.
 * Source: SRS §16 (Project Brief §4a), unified-data-model.md §2.6
 */
export declare const MACRO_GATES: readonly ["Discovery outputs validated", "Preliminary SRS validated", "SRS approved", "Design docs approved", "Implementation plan approved", "Spec file approved", "Code approved", "UAT report approved", "Runbooks approved", "Project documentation approved"];
export type MacroGate = typeof MACRO_GATES[number];
/**
 * Aliases for macro gates — case-insensitive user input maps to canonical names.
 * Source: data-persistence-architecture.md §7.1
 */
export declare const MACRO_GATE_ALIASES: Record<string, MacroGate>;
/**
 * Auto-classify a governance update based on text content.
 * Returns: macro event with matched gate, or micro event.
 * Source: data-persistence-architecture.md §7.1, F-01 §4.1
 */
export declare function classifyEvent(input: {
    update_text: string;
    type?: 'macro' | 'micro';
    flag_override?: boolean;
}): {
    resolvedType: 'macro' | 'micro';
    matchedGate?: string;
};
