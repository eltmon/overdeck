/**
 * Plan-integrity spec diff (PAN-1728 FR-1).
 *
 * The canonical spec is immutable after planning except for its lifecycle
 * status fields. `diffPlanDocuments` compares a reference spec (the one
 * planning finalized) with the spec at HEAD and returns one violation per
 * changed item id and one per changed non-item path. It is pure — no git, no
 * fs — so `plan-integrity-run.ts` owns resolving the two documents.
 */
import { normalizeXBriefEnvelope } from '../xbrief/io.js';

export interface PlanIntegrityViolation {
  /** Item id for item changes; dotted JSON path otherwise (e.g. `plan.narratives`). */
  subject: string;
  kind: 'item-added' | 'item-removed' | 'item-changed' | 'field-changed';
  /** Changed item keys for item-changed (e.g. ['title', 'status']). */
  keys?: string[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON serialization with sorted object keys, so key order never counts as a change. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Normalize the envelope and drop the five fields lifecycle writers change
 * after planning: `status`, `plan.status`, `plan.updated`, `plan.sequence`,
 * `xBRIEFInfo.updated`.
 */
function stripAllowedFields(doc: unknown): JsonObject {
  const normalized = normalizeXBriefEnvelope(doc);
  const copy: JsonObject = isObject(normalized) ? structuredClone(normalized) : {};
  delete copy.status;
  if (isObject(copy.plan)) {
    delete copy.plan.status;
    delete copy.plan.updated;
    delete copy.plan.sequence;
  }
  if (isObject(copy.xBRIEFInfo)) delete copy.xBRIEFInfo.updated;
  return copy;
}

/** Flatten an item tree to `subject → item without its nested items`, in document order. */
function flattenItems(items: unknown, parentPath: string, out: Map<string, unknown>): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    const id = isObject(item) && typeof item.id === 'string' && item.id ? item.id : null;
    const subject = id ?? `${parentPath}[${index}]`;
    if (isObject(item)) {
      const { items: nested, ...own } = item;
      out.set(subject, own);
      flattenItems(nested, `${subject}.items`, out);
    } else {
      out.set(subject, item);
    }
  });
}

function changedKeys(reference: unknown, head: unknown): string[] {
  if (!isObject(reference) || !isObject(head)) return [];
  const keys = new Set([...Object.keys(reference), ...Object.keys(head)]);
  return [...keys].filter((key) => !sameValue(reference[key], head[key])).sort();
}

function diffItems(reference: JsonObject, head: JsonObject): PlanIntegrityViolation[] {
  const referenceItems = new Map<string, unknown>();
  const headItems = new Map<string, unknown>();
  flattenItems(reference.items, 'plan.items', referenceItems);
  flattenItems(head.items, 'plan.items', headItems);

  const violations: PlanIntegrityViolation[] = [];
  for (const [subject, referenceItem] of referenceItems) {
    if (!headItems.has(subject)) {
      violations.push({ subject, kind: 'item-removed' });
      continue;
    }
    const headItem = headItems.get(subject);
    if (sameValue(referenceItem, headItem)) continue;
    const keys = changedKeys(referenceItem, headItem);
    violations.push(keys.length > 0 ? { subject, kind: 'item-changed', keys } : { subject, kind: 'item-changed' });
  }
  for (const subject of headItems.keys()) {
    if (!referenceItems.has(subject)) violations.push({ subject, kind: 'item-added' });
  }
  return violations;
}

function diffFields(reference: JsonObject, head: JsonObject, prefix: string, skip: ReadonlySet<string>): PlanIntegrityViolation[] {
  const keys = [...new Set([...Object.keys(reference), ...Object.keys(head)])].filter((key) => !skip.has(key)).sort();
  return keys
    .filter((key) => !sameValue(reference[key], head[key]))
    .map((key) => ({ subject: `${prefix}${key}`, kind: 'field-changed' as const }));
}

/** Diff a reference spec against the HEAD spec, ignoring only the five allowed lifecycle fields. */
export function diffPlanDocuments(reference: unknown, head: unknown): PlanIntegrityViolation[] {
  const ref = stripAllowedFields(reference);
  const cur = stripAllowedFields(head);
  const refPlan = isObject(ref.plan) ? ref.plan : {};
  const curPlan = isObject(cur.plan) ? cur.plan : {};
  const bothPlansAreObjects = isObject(ref.plan) && isObject(cur.plan);

  return [
    ...diffItems(refPlan, curPlan),
    ...(bothPlansAreObjects ? diffFields(refPlan, curPlan, 'plan.', new Set(['items'])) : []),
    ...diffFields(ref, cur, '', new Set(bothPlansAreObjects ? ['plan'] : [])),
  ];
}
