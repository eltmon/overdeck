/**
 * vBRIEF Module
 *
 * Panopticon's structured planning format based on the vBRIEF v0.5 spec.
 * See: https://github.com/deftai/vBRIEF
 *
 * Usage:
 *   import { planBuilder, validate, readPlan, writePlan } from '../vbrief/index.js';
 *
 *   // Build a plan
 *   const doc = planBuilder('MIN-630: Redesign Daily Briefing')
 *     .status('approved')
 *     .narrative('Problem', 'Current briefing is a wall of text')
 *     .addRequirement('api.response', 'Restructure briefing API', {
 *       acceptanceCriteria: [
 *         { id: 'api.response.ac1', title: 'Response includes urgency_zones' },
 *       ]
 *     })
 *     .blocks('api.response', 'ui.cards')
 *     .build();
 *
 *   // Validate
 *   const result = validate(doc);
 *
 *   // Write to disk
 *   writePlan('.planning/plan.vbrief.json', doc);
 */

// Types
export type {
  VBriefDocument,
  VBriefInfo,
  Plan,
  PlanItem,
  PlanItemMetadata,
  Edge,
  EdgeType,
  PlanStatus,
  ItemKind,
  Priority,
  FeaturePlan,
  ValidationResult,
  ChangeLogEntry,
} from './types.js';

// Builder
export { PlanBuilder, planBuilder } from './builder.js';

// Validator
export { validate, validateFeaturePlan } from './validator.js';

// I/O
export {
  VBRIEF_FILENAME,
  VBRIEF_PLAN_PATH,
  readPlan,
  writePlan,
  findPlan,
  hasPlan,
  collectItemIds,
  getItemsByKind,
  getBlockers,
  getUnblockedItems,
  topologicalOrder,
} from './io.js';
