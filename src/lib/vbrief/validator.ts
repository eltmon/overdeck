/**
 * vBRIEF Validator
 *
 * Validates vBRIEF documents against the v0.5 spec.
 * Checks structural validity, DAG acyclicity, and Panopticon-specific requirements.
 */

import type {
  VBriefDocument,
  Plan,
  PlanItem,
  Edge,
  PlanStatus,
  ValidationResult,
} from './types.js';

const VALID_STATUSES: PlanStatus[] = [
  'draft', 'proposed', 'approved', 'pending',
  'running', 'completed', 'blocked', 'cancelled',
];

const VALID_EDGE_TYPES = ['blocks', 'informs', 'invalidates', 'suggests'];

/**
 * Validate a vBRIEF document.
 *
 * Checks:
 * - Required fields (vBRIEFInfo.version, plan.title, plan.status, plan.items)
 * - Valid status enums
 * - Valid edge types and references
 * - DAG acyclicity (no circular dependencies)
 * - Unique item IDs
 * - planRef URI format
 */
export function validate(doc: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['Document must be a non-null object'], warnings: [] };
  }

  const d = doc as Record<string, unknown>;

  // ── vBRIEFInfo ──
  if (!d.vBRIEFInfo || typeof d.vBRIEFInfo !== 'object') {
    errors.push('Missing required field: vBRIEFInfo');
  } else {
    const info = d.vBRIEFInfo as Record<string, unknown>;
    if (info.version !== '0.5') {
      errors.push(`vBRIEFInfo.version must be "0.5", got "${info.version}"`);
    }
  }

  // ── Plan ──
  if (!d.plan || typeof d.plan !== 'object') {
    errors.push('Missing required field: plan');
    return { valid: false, errors, warnings };
  }

  const plan = d.plan as Plan;

  if (!plan.title || typeof plan.title !== 'string') {
    errors.push('plan.title is required and must be a string');
  }

  if (!plan.status || !VALID_STATUSES.includes(plan.status)) {
    errors.push(`plan.status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (!Array.isArray(plan.items)) {
    errors.push('plan.items is required and must be an array');
    return { valid: false, errors, warnings };
  }

  // ── Items ──
  const allIds = new Set<string>();

  function validateItem(item: PlanItem, path: string): void {
    if (!item.title || typeof item.title !== 'string') {
      errors.push(`${path}: title is required and must be a string`);
    }
    if (!item.status || !VALID_STATUSES.includes(item.status)) {
      errors.push(`${path}: status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    if (item.id) {
      if (allIds.has(item.id)) {
        errors.push(`${path}: duplicate item ID "${item.id}"`);
      }
      allIds.add(item.id);
    }

    if (item.planRef && typeof item.planRef === 'string') {
      if (!item.planRef.startsWith('#') && !item.planRef.startsWith('file://') && !item.planRef.startsWith('https://')) {
        warnings.push(`${path}: planRef "${item.planRef}" uses non-standard URI scheme`);
      }
    }

    if (item.percentComplete !== undefined) {
      if (typeof item.percentComplete !== 'number' || item.percentComplete < 0 || item.percentComplete > 100) {
        errors.push(`${path}: percentComplete must be a number between 0 and 100`);
      }
    }

    if (item.subItems && Array.isArray(item.subItems)) {
      for (let i = 0; i < item.subItems.length; i++) {
        validateItem(item.subItems[i], `${path}.subItems[${i}]`);
      }
    }
  }

  for (let i = 0; i < plan.items.length; i++) {
    validateItem(plan.items[i], `plan.items[${i}]`);
  }

  // ── Edges ──
  if (plan.edges && Array.isArray(plan.edges)) {
    for (let i = 0; i < plan.edges.length; i++) {
      const edge = plan.edges[i];
      const ePath = `plan.edges[${i}]`;

      if (!edge.from || typeof edge.from !== 'string') {
        errors.push(`${ePath}: "from" is required`);
      }
      if (!edge.to || typeof edge.to !== 'string') {
        errors.push(`${ePath}: "to" is required`);
      }
      if (!edge.type || !VALID_EDGE_TYPES.includes(edge.type)) {
        errors.push(`${ePath}: type must be one of: ${VALID_EDGE_TYPES.join(', ')}`);
      }

      // Check that edge references exist (only if IDs are being used)
      if (allIds.size > 0) {
        if (edge.from && !allIds.has(edge.from)) {
          warnings.push(`${ePath}: "from" references unknown item ID "${edge.from}"`);
        }
        if (edge.to && !allIds.has(edge.to)) {
          warnings.push(`${ePath}: "to" references unknown item ID "${edge.to}"`);
        }
      }
    }

    // Check for cycles in blocking edges
    const cycleErrors = detectCycles(plan.edges.filter(e => e.type === 'blocks'));
    errors.push(...cycleErrors);
  }

  // ── Warnings for best practices ──
  if (!plan.narratives || Object.keys(plan.narratives).length === 0) {
    warnings.push('Plan has no narratives — consider adding Problem, Constraint, or Risk context');
  }

  const itemsWithoutIds = plan.items.filter(i => !i.id);
  if (itemsWithoutIds.length > 0 && plan.edges && plan.edges.length > 0) {
    warnings.push(`${itemsWithoutIds.length} items have no ID but edges exist — edges cannot reference these items`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detect cycles in a set of directed edges (blocking dependencies).
 * Returns error messages for each cycle found.
 */
function detectCycles(edges: Edge[]): string[] {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }

  const errors: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      errors.push(`Dependency cycle detected: ${cycle.join(' → ')}`);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      dfs(neighbor, [...path]);
    }

    inStack.delete(node);
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return errors;
}

/**
 * Validate that a document meets Panopticon feature-plan requirements:
 * - Has at least one story item (kind: "story")
 * - Has edges defining story dependencies
 * - Has architectural decisions
 * - Has Problem/Constraint narratives
 */
export function validateFeaturePlan(doc: VBriefDocument): ValidationResult {
  const base = validate(doc);
  const errors = [...base.errors];
  const warnings = [...base.warnings];

  const stories = doc.plan.items.filter(i => i.metadata?.kind === 'story');
  if (stories.length === 0) {
    errors.push('Feature plan must contain at least one story item (metadata.kind: "story")');
  }

  const decisions = doc.plan.items.filter(i => i.metadata?.kind === 'architectural_decision');
  if (decisions.length === 0) {
    warnings.push('Feature plan has no architectural decisions — consider adding shared design context');
  }

  if (!doc.plan.narratives?.Problem) {
    warnings.push('Feature plan missing "Problem" narrative');
  }

  if (stories.length > 1 && (!doc.plan.edges || doc.plan.edges.length === 0)) {
    warnings.push('Feature plan has multiple stories but no dependency edges');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
