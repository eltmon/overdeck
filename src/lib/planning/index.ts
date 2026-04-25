/**
 * Planning Module - Utilities for pre-work planning
 *
 * - Triage utilities: Rule-based issue prioritization and classification
 * - Planning Agent: Architecture and approach planning (HOW to build)
 * - Plan utilities: Shared STATE.md generation, PRD discovery, complexity analysis
 */

// Triage utilities
export {
  analyzeIssue,
  triageMultiple,
  sortByPriority,
  type TriageResult,
  type TriageOptions,
} from './triage-agent.js';

// Planning Agent (Architecture focus)
export {
  generatePlanningDocument,
  createPlanningDocument,
  spawnPlanningAgent,
  validatePlanningDocument,
  type PlanningOptions,
  type ArchitectureDecision,
  type PlanningDocument,
} from './planning-agent.js';

// Plan Utilities (shared between CLI and dashboard)
// NOTE: plan-utils.ts was deleted — all functions were dead code.
// Planning now uses spawn-planning-session.ts for agent-based planning.

