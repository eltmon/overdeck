import {
  compileGlob,
  getDispatchableItems,
  groupItemsByWave,
  hasFileOverlap,
  type CompiledGlob,
  type Wave,
} from './dag.js';
import { Effect } from 'effect';
import type { FsError } from '../errors.js';
import { findSpecByIssue } from '../pan-dir/specs.js';
import type { FilesScopeConfidence, ItemReadiness, VBriefDocument, VBriefItem } from './types.js';

export interface SwarmReadinessOptions {
  hotspots?: string[];
}

export interface SwarmReadinessOverlap {
  itemId: string;
  sharedFiles: string[];
}

export interface SwarmReadinessItemVerdict {
  id: string;
  readiness?: ItemReadiness;
  slotEligible: boolean;
  scopeConfidence?: FilesScopeConfidence;
  missingScope: boolean;
  overlaps: SwarmReadinessOverlap[];
}

export interface SwarmReadinessConflictGroup {
  itemIds: string[];
  sharedFiles: string[];
  reason: 'file_overlap' | 'low_confidence';
}

export interface SwarmReadinessVerdict {
  items: SwarmReadinessItemVerdict[];
  waves: Wave[];
  conflictGroups: SwarmReadinessConflictGroup[];
  overlapMatrix: Record<string, Record<string, string[]>>;
  swarmEligible: boolean;
}

export function computeIssueFootprint(doc: VBriefDocument): string[] {
  const footprint = new Set<string>();
  for (const item of doc.plan.items) {
    for (const filePath of item.metadata?.files_scope ?? []) {
      footprint.add(filePath);
    }
  }
  return Array.from(footprint).sort();
}

export function resolveIssueFootprint(
  projectRoot: string,
  issueId: string,
): Effect.Effect<string[], FsError> {
  return Effect.gen(function* () {
    const spec = yield* findSpecByIssue(projectRoot, issueId);
    return spec ? computeIssueFootprint(spec.document) : [];
  });
}

interface NormalizedItem {
  item: VBriefItem;
  scope: string[];
  lowConfidence: boolean;
  missingScope: boolean;
}

export function analyzeSwarmReadiness(
  doc: VBriefDocument,
  opts: SwarmReadinessOptions = {},
): SwarmReadinessVerdict {
  const hotspots = (opts.hotspots ?? []).map(compileGlob);
  const normalizedItems = doc.plan.items.map(item => normalizeItem(item, hotspots));
  const normalizedById = new Map(normalizedItems.map(item => [item.item.id, item]));
  const itemVerdicts = new Map<string, SwarmReadinessItemVerdict>();
  const overlapMatrix = Object.fromEntries(
    doc.plan.items.map(item => [item.id, {} as Record<string, string[]>]),
  );
  const conflictGroups: SwarmReadinessConflictGroup[] = [];

  for (const item of doc.plan.items) {
    itemVerdicts.set(item.id, {
      id: item.id,
      readiness: item.metadata?.readiness,
      slotEligible: isSlotEligible(item, normalizedById.get(item.id)),
      scopeConfidence: item.metadata?.files_scope_confidence,
      missingScope: normalizedById.get(item.id)?.missingScope ?? true,
      overlaps: [],
    });
  }

  for (let i = 0; i < normalizedItems.length; i++) {
    for (let j = i + 1; j < normalizedItems.length; j++) {
      const left = normalizedItems[i]!;
      const right = normalizedItems[j]!;
      const overlap = analyzePairOverlap(left, right);
      if (!overlap.overlaps) continue;

      overlapMatrix[left.item.id]![right.item.id] = overlap.sharedFiles;
      overlapMatrix[right.item.id]![left.item.id] = overlap.sharedFiles;
      itemVerdicts.get(left.item.id)?.overlaps.push({ itemId: right.item.id, sharedFiles: overlap.sharedFiles });
      itemVerdicts.get(right.item.id)?.overlaps.push({ itemId: left.item.id, sharedFiles: overlap.sharedFiles });
      conflictGroups.push({
        itemIds: [left.item.id, right.item.id],
        sharedFiles: overlap.sharedFiles,
        reason: overlap.lowConfidence ? 'low_confidence' : 'file_overlap',
      });
    }
  }

  const dispatchableIds = new Set(getDispatchableItems(doc, new Set()).map(item => item.id));
  return {
    items: doc.plan.items.map(item => itemVerdicts.get(item.id)!),
    waves: groupItemsByWave(doc),
    conflictGroups,
    overlapMatrix,
    swarmEligible: Array.from(itemVerdicts.values()).some(item => item.slotEligible && dispatchableIds.has(item.id)),
  };
}

function normalizeItem(item: VBriefItem, hotspots: CompiledGlob[]): NormalizedItem {
  const rawScope = item.metadata?.files_scope ?? [];
  return {
    item,
    scope: rawScope.filter(filePath => !pathMatchesAnyCompiled(filePath, hotspots)),
    lowConfidence: item.metadata?.files_scope_confidence === 'low',
    missingScope: rawScope.length === 0,
  };
}

function isSlotEligible(item: VBriefItem, normalized?: NormalizedItem): boolean {
  if (!normalized || normalized.missingScope || normalized.lowConfidence) return false;
  return item.metadata?.readiness === 'ready'
    && normalized.scope.length > 0
    && (item.metadata.verify_commands?.length ?? 0) > 0
    && (item.metadata.expected_outputs?.length ?? 0) > 0;
}

function analyzePairOverlap(
  left: NormalizedItem,
  right: NormalizedItem,
): { overlaps: boolean; sharedFiles: string[]; lowConfidence: boolean } {
  if (left.lowConfidence || right.lowConfidence) {
    return { overlaps: true, sharedFiles: sharedFilesFor(left, right), lowConfidence: true };
  }

  const leftItem = withScope(left.item, left.scope);
  const rightItem = withScope(right.item, right.scope);
  if (!hasFileOverlap([leftItem], rightItem)) {
    return { overlaps: false, sharedFiles: [], lowConfidence: false };
  }

  return { overlaps: true, sharedFiles: sharedFilesFor(left, right), lowConfidence: false };
}

function withScope(item: VBriefItem, scope: string[]): VBriefItem {
  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      files_scope: scope,
    },
  };
}

function sharedFilesFor(left: NormalizedItem, right: NormalizedItem): string[] {
  const leftPatterns = left.scope.map(compileGlob);
  const rightPatterns = right.scope.map(compileGlob);
  const shared = new Set<string>();

  for (const filePath of left.scope) {
    if (pathMatchesAnyCompiled(filePath, rightPatterns)) shared.add(filePath);
  }
  for (const filePath of right.scope) {
    if (pathMatchesAnyCompiled(filePath, leftPatterns)) shared.add(filePath);
  }

  return Array.from(shared).sort();
}

function pathMatchesAnyCompiled(filePath: string, patterns: CompiledGlob[]): boolean {
  return patterns.some(pattern => pattern.regex.test(filePath) || pattern.exactDirectory === filePath);
}
