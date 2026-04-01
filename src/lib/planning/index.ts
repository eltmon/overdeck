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
export {
  findPRDFiles,
  analyzeComplexity,
  generateStateContent,
  estimateTaskDifficulty,
  writePlanFiles,
  copyToPRDDirectory,
  executePlan,
  type PlanIssue,
  type PlanTask,
  type DiscoveryDecision,
  type ComplexityAnalysis,
  type PlanResult,
} from './plan-utils.js';

