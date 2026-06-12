"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MACRO_GATE_ALIASES = exports.MACRO_GATES = void 0;
exports.classifyEvent = classifyEvent;
/**
 * Canonical macro gate names — single source of truth for gate string comparisons.
 * Must import from here — never hardcode gate strings.
 * Source: SRS §16 (Project Brief §4a), unified-data-model.md §2.6
 */
exports.MACRO_GATES = [
    'Discovery outputs validated',
    'Preliminary SRS validated',
    'SRS approved',
    'Design docs approved',
    'Implementation plan approved',
    'Spec file approved',
    'Code approved',
    'UAT report approved',
    'Runbooks approved',
    'Project documentation approved',
];
/**
 * Aliases for macro gates — case-insensitive user input maps to canonical names.
 * Source: data-persistence-architecture.md §7.1
 */
exports.MACRO_GATE_ALIASES = {
    'solution architecture approved': 'Design docs approved',
    'sprint plan approved': 'Implementation plan approved',
    'documentation approved': 'Runbooks approved',
};
/**
 * Auto-classify a governance update based on text content.
 * Returns: macro event with matched gate, or micro event.
 * Source: data-persistence-architecture.md §7.1, F-01 §4.1
 */
function classifyEvent(input) {
    // If caller provided explicit type + flag_override, use it as-is
    if (input.flag_override && input.type) {
        return { resolvedType: input.type, matchedGate: undefined };
    }
    const lowerText = input.update_text.toLowerCase().trim();
    // Try alias matches first
    for (const [alias, canonical] of Object.entries(exports.MACRO_GATE_ALIASES)) {
        if (lowerText.includes(alias.toLowerCase())) {
            return { resolvedType: 'macro', matchedGate: canonical };
        }
    }
    // Try canonical gate matches
    for (const gate of exports.MACRO_GATES) {
        if (lowerText.includes(gate.toLowerCase())) {
            return { resolvedType: 'macro', matchedGate: gate };
        }
    }
    // No match → micro event
    return { resolvedType: 'micro' };
}
