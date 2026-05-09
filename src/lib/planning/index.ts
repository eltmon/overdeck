/**
 * Planning Module - Utilities for pre-work planning
 *
 * - Triage utilities: Rule-based issue prioritization and classification
 *
 * Planning is now driven by `spawn-planning-session.ts` and the prompt at
 * `src/lib/cloister/prompts/planning.md`, which writes `.pan/continue.json`
 * and `.pan/spec.vbrief.json` (STATE.md is removed).
 */

// Triage utilities
export {
  analyzeIssue,
  triageMultiple,
  sortByPriority,
  type TriageResult,
  type TriageOptions,
} from './triage-agent.js';
