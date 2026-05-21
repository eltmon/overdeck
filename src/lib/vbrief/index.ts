/**
 * vBRIEF Module
 *
 * Panopticon's structured planning format based on the vBRIEF v0.5 spec.
 * See: https://github.com/deftai/vBRIEF
 *
 * All date fields MUST use RFC 3339 date-time format ("2025-09-01T00:00:00Z"),
 * NOT plain dates ("2025-09-01"). Use toRFC3339() to convert if needed.
 */

// Types
export type {
  VBriefDocument,
  VBriefPlan,
  VBriefItem,
  VBriefSubItem,
  VBriefEdge,
  VBriefEdgeType,
  VBriefItemStatus,
  VBriefPriority,
  VBriefDifficulty,
} from './types.js';

// Date helpers
export { isRFC3339DateTime, toRFC3339 } from './types.js';

// Builder
export { PlanBuilder, planBuilder } from './builder.js';

// I/O (from PAN-388 agent's implementation)
export {
  findPlan,
  readPlan,
  readWorkspacePlan,
  updateItemStatus,
  updateSubItemStatus,
} from './io.js';

// Effect-typed IO variants (PAN-1249)
export {
  readPlanEffect,
  findPlanEffect,
  readWorkspacePlanEffect,
  VBriefMergeConflictTaggedError,
  VBriefInvalidFormatError,
} from './io.js';
export type { VBriefReadError } from './io.js';

// Beads integration
export { createBeadsFromVBrief, syncBeadStatusToVBrief, getVBriefACStatus } from './beads.js';
export type { CreateBeadsResult, VBriefACStatus, ItemACStatus } from './beads.js';

// Acceptance Criteria
export {
  extractAcceptanceCriteria,
  extractACFromDocument,
  formatAcceptanceCriteria,
  checkAllCriteriaCompleted,
} from './acceptance-criteria.js';
export type { AcceptanceCriterion, ACCompletionResult } from './acceptance-criteria.js';
