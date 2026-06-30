import {
  subItemsOf,
  type FilesScopeConfidence,
  type ItemReadiness,
  type VBriefDifficulty,
  type VBriefDocument,
  type VBriefItem,
  type VBriefItemMetadata,
  type VBriefSubItem,
} from './types.js';
import { analyzeSwarmReadiness } from './swarm-readiness.js';

export interface QualityIssue {
  itemId: string | null;
  rule: string;
  message: string;
  severity: 'error' | 'warn';
}

export class PlanQualityLintError extends Error {
  constructor(public readonly issues: QualityIssue[]) {
    super(`vBRIEF quality lint failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}`);
    this.name = 'PlanQualityLintError';
  }
}

export interface QualityLintOptions {
  prdText?: string;
  hotspots?: string[];
}

// These lists are summarized in src/lib/cloister/prompts/planning.md (WI-14) — update both together.
export const PLACEHOLDER_AC_PATTERNS = ['acceptance criteria for', 'copy from parent', 'copy from specification', 'placeholder', 'refine from parent', 'tbd', 'to be defined', 'to refine', 'todo'];
export const DOCS_ONLY_AC_PATTERNS = ['docs updated', 'documentation updated', 'readme updated', 'update docs', 'update documentation', 'update readme'];
export const VAGUE_AC_PATTERNS = ['displays a message', 'handles errors', 'is implemented', 'is updated', 'passes tests', 'shows a message', 'updates the ui', 'works as expected', 'make it work', 'implement the feature', 'change the code', 'update the code'];
export const OBSERVABLE_TERMS = ['blocks', 'creates', 'deletes', 'displays', 'emits', 'fails', 'persists', 'records', 'redirects', 'rejects', 'renders', 'returns', 'saves', 'shows', 'stores', 'updates', 'validates', 'exits', 'prints', 'logs', 'throws', 'spawns', 'opens', 'closes', 'sends', 'receives', 'resolves', 'refuses', 'marks', 'syncs', 'commits', 'pushes', 'accepts', 'applies', 'collapses', 'contains', 'covers', 'defaults to', 'falls back', 'preserves', 'produces', 'passes', 'respects', 'routes', 'survives', 'wins', 'when ', 'given ', 'then '];

const BANNED_AC_PATTERNS = [
  ...PLACEHOLDER_AC_PATTERNS,
  ...DOCS_ONLY_AC_PATTERNS,
  ...VAGUE_AC_PATTERNS,
];

const FILES_SCOPE_CONFIDENCE_VALUES = new Set<FilesScopeConfidence>(['high', 'medium', 'low']);
const ITEM_READINESS_VALUES = new Set<ItemReadiness>(['ready', 'sequential', 'needs_refinement']);
const HEAVY_DIFFICULTIES = new Set<VBriefDifficulty>(['complex', 'expert']);
const PARALLEL_SAFE_REASON_FIELDS = ['parallelSafeReason', 'parallel_safe_reason', 'readinessReason', 'readiness_reason'];

function issue(itemId: string | null, rule: string, message: string): QualityIssue {
  return { itemId, rule, message, severity: 'error' };
}

function warning(itemId: string | null, rule: string, message: string): QualityIssue {
  return { itemId, rule, message, severity: 'warn' };
}

function acceptanceCriteria(item: VBriefItem): VBriefSubItem[] {
  return subItemsOf(item).filter(subItem => subItem.metadata?.kind === 'acceptance_criterion');
}

function hasAcJustification(item: VBriefItem): boolean {
  const value = item.metadata?.acJustification;
  return typeof value === 'string' && value.trim().length > 0;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function hasParallelSafeReason(metadata: VBriefItemMetadata): boolean {
  return PARALLEL_SAFE_REASON_FIELDS.some(field => (stringValue(metadata[field])?.length ?? 0) > 0);
}

function hasFilenameLikeSegment(value: string): boolean {
  const segment = value.split('/').filter(Boolean).at(-1) ?? value;
  return segment.includes('.');
}

function isBroadFilesScope(value: string): boolean {
  const scope = value.trim();
  if (!scope) return true;
  if (scope.includes('**')) return true;
  if (scope.endsWith('/')) return true;
  if (scope.includes('*') && !scope.includes('/')) return true;
  return !scope.includes('*') && !hasFilenameLikeSegment(scope);
}

function lintRequiredDispatchMetadata(item: VBriefItem): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const metadata = item.metadata ?? {};
  const filesScope = metadata.files_scope;

  if (!Array.isArray(filesScope) || filesScope.length === 0) {
    issues.push(issue(item.id, 'files-scope-missing', `Item ${item.id} metadata.files_scope is required and must name at least one concrete file or narrow glob`));
  } else {
    for (const scope of filesScope) {
      if (typeof scope !== 'string' || scope.trim().length === 0) {
        issues.push(issue(item.id, 'files-scope-invalid', `Item ${item.id} metadata.files_scope contains an empty or non-string entry`));
      } else if (isBroadFilesScope(scope)) {
        issues.push(issue(item.id, 'files-scope-broad', `Item ${item.id} metadata.files_scope entry "${scope}" is too broad; use concrete files or narrow globs`));
      }
    }
  }

  if (!FILES_SCOPE_CONFIDENCE_VALUES.has(metadata.files_scope_confidence as FilesScopeConfidence)) {
    issues.push(issue(item.id, 'files-scope-confidence-missing', `Item ${item.id} metadata.files_scope_confidence is required and must be high, medium, or low`));
  }

  if (!ITEM_READINESS_VALUES.has(metadata.readiness as ItemReadiness)) {
    issues.push(issue(item.id, 'readiness-missing', `Item ${item.id} metadata.readiness is required and must be ready, sequential, or needs_refinement`));
  }

  if (metadata.readiness === 'ready' && metadata.files_scope_confidence === 'low') {
    issues.push(issue(item.id, 'ready-low-confidence', `Item ${item.id} cannot be readiness:ready with files_scope_confidence:low`));
  }

  if (metadata.readiness === 'ready' && metadata.difficulty && HEAVY_DIFFICULTIES.has(metadata.difficulty) && !hasParallelSafeReason(metadata)) {
    issues.push(warning(item.id, 'complex-ready-without-reason', `Item ${item.id} is ${metadata.difficulty} and readiness:ready but does not state why it is parallel-safe`));
  }

  const expectedOutputs = metadata.expected_outputs;
  if (Array.isArray(expectedOutputs)) {
    for (const [index, output] of expectedOutputs.entries()) {
      if (typeof output !== 'string') continue;
      const banned = BANNED_AC_PATTERNS.find(pattern => output.toLowerCase().includes(pattern));
      if (banned) {
        issues.push(issue(item.id, 'expected-output-banned-phrase', `Item ${item.id} metadata.expected_outputs[${index}] contains banned phrase "${banned}"`));
      }
    }
  }

  return issues;
}

function lintItem(item: VBriefItem): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const acs = acceptanceCriteria(item);

  if (acs.length === 0) {
    issues.push(issue(item.id, 'ac-missing', `Item ${item.id} has no acceptance criteria`));
  } else if (!hasAcJustification(item) && (acs.length < 2 || acs.length > 5)) {
    issues.push(issue(item.id, 'ac-count', `Item ${item.id} has ${acs.length} acceptance criterion; expected 2-5 or metadata.acJustification`));
  }

  for (const ac of acs) {
    const title = ac.title.toLowerCase();
    const banned = BANNED_AC_PATTERNS.find(pattern => title.includes(pattern));
    if (banned) {
      issues.push(issue(item.id, 'ac-banned-phrase', `Acceptance criterion ${ac.id} contains banned phrase "${banned}"`));
    }
    if (!OBSERVABLE_TERMS.some(term => title.includes(term))) {
      issues.push(issue(item.id, 'ac-not-observable', `Acceptance criterion ${ac.id} does not name observable behavior`));
    }
  }

  const action = item.narrative?.Action?.trim() ?? '';
  if (!action || wordCount(action) < 8) {
    issues.push(issue(item.id, 'action-too-thin', `Item ${item.id} narrative.Action must contain at least 8 words`));
  }

  if (!Object.prototype.hasOwnProperty.call(item.metadata ?? {}, 'requiresInspection')) {
    issues.push(issue(item.id, 'inspection-missing', `Item ${item.id} metadata.requiresInspection is required`));
  }

  const foundationFor = item.metadata?.foundationFor;
  if (item.metadata?.requiresInspection === true && (!Array.isArray(foundationFor) || foundationFor.length === 0)) {
    issues.push(issue(item.id, 'inspection-without-foundation', `Item ${item.id} requires inspection but has no metadata.foundationFor entries`));
  }

  issues.push(...lintRequiredDispatchMetadata(item));

  return issues;
}

function lintDocumentReferences(doc: VBriefDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const itemIds = new Set(doc.plan.items.map(item => item.id));

  for (const edge of doc.plan.edges ?? []) {
    if (!itemIds.has(edge.from)) {
      issues.push(issue(null, 'edge-unknown-id', `Edge references unknown from item "${edge.from}"`));
    }
    if (!itemIds.has(edge.to)) {
      issues.push(issue(null, 'edge-unknown-id', `Edge references unknown to item "${edge.to}"`));
    }
  }

  for (const item of doc.plan.items) {
    const foundationFor = item.metadata?.foundationFor;
    if (!Array.isArray(foundationFor)) continue;
    for (const target of foundationFor) {
      if (typeof target !== 'string' || !itemIds.has(target)) {
        issues.push(issue(item.id, 'foundationFor-unknown-id', `Item ${item.id} metadata.foundationFor references unknown item "${String(target)}"`));
      }
    }
  }

  if (hasBlocksCycle(doc)) {
    issues.push(issue(null, 'edge-cycle', 'Plan contains a cycle in blocks edges'));
  }

  return issues;
}

function collectDeclaredTraceIds(prdText: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /^[-*\s]*\b(FR|NFR)-\d+\b/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prdText)) !== null) {
    const id = match[0].match(/\b(?:FR|NFR)-\d+\b/)?.[0];
    if (id) ids.add(id);
  }
  return ids;
}

function collectCoveredTraceIds(doc: VBriefDocument): Set<string> {
  const ids = new Set<string>();
  for (const item of doc.plan.items) {
    if (item.status === 'cancelled') continue;
    const traces = item.metadata?.traces;
    if (!Array.isArray(traces)) continue;
    for (const trace of traces) {
      if (typeof trace === 'string') ids.add(trace);
    }
  }
  return ids;
}

function lintTraceCoverage(doc: VBriefDocument, prdText?: string): QualityIssue[] {
  if (!prdText) return [];
  const declared = collectDeclaredTraceIds(prdText);
  if (declared.size === 0) return [];
  const covered = collectCoveredTraceIds(doc);
  return Array.from(declared)
    .filter(id => !covered.has(id))
    .map(id => warning(null, 'trace-uncovered', `Requirement ${id} is declared in the PRD but no plan item metadata.traces references it`));
}

function orderedPairKey(left: string, right: string): string {
  return [left, right].sort().join('\0');
}

function connectedBlocksPairs(doc: VBriefDocument): Set<string> {
  const itemIds = new Set(doc.plan.items.map(item => item.id));
  const pairs = new Set<string>();
  for (const edge of doc.plan.edges ?? []) {
    if (edge.type !== 'blocks' || !itemIds.has(edge.from) || !itemIds.has(edge.to)) continue;
    pairs.add(orderedPairKey(edge.from, edge.to));
  }
  return pairs;
}

function lintOverlapAudit(doc: VBriefDocument, options: Pick<QualityLintOptions, 'hotspots'> = {}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const activeItemIds = new Set(doc.plan.items.filter(item => item.status !== 'cancelled').map(item => item.id));
  const connectedPairs = connectedBlocksPairs(doc);
  const seenPairs = new Set<string>();
  const verdict = analyzeSwarmReadiness(doc, { hotspots: options.hotspots });

  for (const group of verdict.conflictGroups) {
    if (group.itemIds.length !== 2 || group.sharedFiles.length === 0) continue;
    const [left, right] = group.itemIds;
    if (!left || !right || !activeItemIds.has(left) || !activeItemIds.has(right)) continue;

    const pairKey = orderedPairKey(left, right);
    if (connectedPairs.has(pairKey) || seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    issues.push(warning(
      null,
      'files-scope-overlap',
      `Items ${left} and ${right} have overlapping metadata.files_scope entries: ${group.sharedFiles.join(', ')}. Add a blocks edge, merge the items, or accept serialization.`,
    ));
  }

  return issues;
}

function hasBlocksCycle(doc: VBriefDocument): boolean {
  const itemIds = new Set(doc.plan.items.map(item => item.id));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const id of itemIds) {
    inDegree.set(id, 0);
    outgoing.set(id, []);
  }

  for (const edge of doc.plan.edges ?? []) {
    if (edge.type !== 'blocks' || !itemIds.has(edge.from) || !itemIds.has(edge.to)) continue;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const queue = Array.from(itemIds).filter(id => (inDegree.get(id) ?? 0) === 0);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    visited++;
    for (const next of outgoing.get(current) ?? []) {
      const nextDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  return visited < itemIds.size;
}

export function lintPlanQuality(doc: VBriefDocument, options: QualityLintOptions = {}): QualityIssue[] {
  return [
    ...doc.plan.items.flatMap(item => item.status === 'cancelled' ? [] : lintItem(item)),
    ...lintDocumentReferences(doc),
    ...lintTraceCoverage(doc, options.prdText),
    ...lintOverlapAudit(doc, options),
  ];
}

export function qualityLintErrors(doc: VBriefDocument, options: QualityLintOptions = {}): QualityIssue[] {
  return lintPlanQuality(doc, options).filter(issue => issue.severity === 'error');
}

export function formatQualityIssues(issues: QualityIssue[]): string[] {
  const grouped = new Map<string, QualityIssue[]>();
  for (const issue of issues) {
    const key = issue.itemId ?? '<plan>';
    grouped.set(key, [...(grouped.get(key) ?? []), issue]);
  }

  const lines: string[] = [];
  for (const [itemId, itemIssues] of grouped) {
    lines.push(`${itemId}:`);
    for (const issue of itemIssues) {
      lines.push(`  [${issue.severity}] ${issue.rule}: ${issue.message}`);
    }
  }
  return lines;
}

export function assertPlanQuality(doc: VBriefDocument, options: QualityLintOptions = {}): QualityIssue[] {
  const issues = lintPlanQuality(doc, options);
  const errors = issues.filter(issue => issue.severity === 'error');
  if (errors.length > 0) {
    throw new PlanQualityLintError(issues);
  }
  return issues;
}
