// E3 plan quality: is a model's xBRIEF schema-valid and lint-clean, and how close is it to
// the reference spec a real planning session committed? Pure: no fs, no network.
import { parseXBriefDocument } from '../../src/lib/xbrief/io.js';
import { lintPlanQuality } from '../../src/lib/xbrief/quality-lint.js';
import type { XBriefDocument, XBriefItem } from '../../src/lib/xbrief/types.js';

export interface PlanQualityCase {
  id: string;
  issueId: string;
  issueState: 'CLOSED';
  title: string;
  url: string;
  /** Issue body captured at fixture time. */
  body: string;
  /** Repo-relative .pan/drafts/<id>.md */
  prdPath: string;
  /** Repo-relative .pan/specs/<spec>.json */
  referenceSpecPath: string;
}

export function parsePlanQualityCase(data: unknown): PlanQualityCase {
  const c = data as Partial<PlanQualityCase> | null;
  const label = c && typeof c.id === 'string' ? c.id : '(unknown)';
  const strings = ['id', 'issueId', 'title', 'url', 'body', 'prdPath', 'referenceSpecPath'] as const;
  if (!c || typeof c !== 'object' || strings.some((k) => typeof c[k] !== 'string' || c[k] === '')) {
    throw new Error(`Invalid plan-quality case ${label}: needs non-empty ${strings.join(', ')}`);
  }
  if (c.issueState !== 'CLOSED') throw new Error(`Invalid plan-quality case ${label}: issueState must be CLOSED`);
  if (!c.prdPath!.startsWith('.pan/drafts/')) throw new Error(`Invalid plan-quality case ${label}: prdPath must be under .pan/drafts/`);
  if (!c.referenceSpecPath!.startsWith('.pan/specs/')) {
    throw new Error(`Invalid plan-quality case ${label}: referenceSpecPath must be under .pan/specs/`);
  }
  return c as PlanQualityCase;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whole text, then a ```json fence, then the first balanced {...}. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const whole = tryParseObject(trimmed);
  if (whole) return whole;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const fenced = tryParseObject(fenceMatch[1]!.trim());
    if (fenced) return fenced;
  }

  const start = trimmed.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          const balanced = tryParseObject(trimmed.slice(start, i + 1));
          if (balanced) return balanced;
          break;
        }
      }
    }
  }

  throw new Error('No JSON object found in response');
}

export const DIFFICULTY_RANK = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 } as const;

function meanDifficultyRank(items: XBriefItem[]): number | null {
  const ranks = items
    .map((item) => item.metadata?.difficulty)
    .filter((d): d is keyof typeof DIFFICULTY_RANK => typeof d === 'string' && d in DIFFICULTY_RANK)
    .map((d): number => DIFFICULTY_RANK[d]);
  return ranks.length === 0 ? null : ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

function normalizeScope(scope: string): string {
  return scope.trim().replace(/^\.\//, '').replace(/\/\*\*$|\/\*$/, '');
}

function fileScopeSet(items: XBriefItem[]): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const scopes = item.metadata?.files_scope;
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      if (typeof scope === 'string' && scope.trim() !== '') set.add(normalizeScope(scope));
    }
  }
  return set;
}

export interface PlanQualityScores {
  schemaPass: 0 | 1;
  lintErrors: number;
  lintPass: 0 | 1;
  difficultyAgreement: number;
  fileScopeOverlap: number;
  itemCountAgreement: number;
  score: number;
}

const FAILED: PlanQualityScores = {
  schemaPass: 0,
  lintErrors: 0,
  lintPass: 0,
  difficultyAgreement: 0,
  fileScopeOverlap: 0,
  itemCountAgreement: 0,
  score: 0,
};

export function scorePlanQuality(output: string, reference: XBriefDocument, prdText: string): PlanQualityScores {
  let doc: XBriefDocument;
  let lintErrors: number;
  try {
    doc = parseXBriefDocument(JSON.stringify(extractJsonObject(output)), 'model output');
    if (!Array.isArray(doc.plan.items) || doc.plan.items.length === 0) return FAILED;
    lintErrors = lintPlanQuality(doc, { prdText }).filter((issue) => issue.severity === 'error').length;
  } catch {
    // No JSON, an invalid envelope, or a shape the linter cannot walk: the plan is not schema-valid.
    return FAILED;
  }
  const lintPass: 0 | 1 = lintErrors === 0 ? 1 : 0;

  const modelRank = meanDifficultyRank(doc.plan.items);
  const referenceRank = meanDifficultyRank(reference.plan.items);
  const difficultyAgreement = modelRank === null || referenceRank === null ? 0 : 1 - Math.abs(modelRank - referenceRank) / 4;

  const modelScopes = fileScopeSet(doc.plan.items);
  const referenceScopes = fileScopeSet(reference.plan.items);
  const union = new Set([...modelScopes, ...referenceScopes]);
  const intersection = [...modelScopes].filter((s) => referenceScopes.has(s)).length;
  const fileScopeOverlap = union.size === 0 ? 0 : intersection / union.size;

  const a = doc.plan.items.length;
  const b = reference.plan.items.length;
  const itemCountAgreement = Math.min(a, b) / Math.max(a, b);

  return {
    schemaPass: 1,
    lintErrors,
    lintPass,
    difficultyAgreement,
    fileScopeOverlap,
    itemCountAgreement,
    score: 0.4 * lintPass + 0.2 * difficultyAgreement + 0.2 * fileScopeOverlap + 0.2 * itemCountAgreement,
  };
}
