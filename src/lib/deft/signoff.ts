/**
 * Sign off a Deft scope item's disposition (PAN-4849 WI-10, PAN-4820 AD-12).
 *
 * Deft accepts a waived/deferred/not-applicable disposition only when its
 * provenance is not an agent's. A dashboard sign-off sets
 * `provenance = { kind: 'human-event', actor }` and `recorded_at`, keeping
 * the disposition and reason, and rewrites the scope file atomically.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SCOPE_PATH = /^xbrief\/(proposed|pending|active|completed|cancelled)\/[^/]+\.xbrief\.json$/;
const HUMAN_PROVENANCE_KINDS = new Set(['operator-cli', 'operator-session', 'human-event']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export async function signOffDisposition(
  worktree: string,
  scopeRelPath: string,
  itemId: string,
  actor: string,
  now: Date = new Date(),
): Promise<'signed' | 'not-needed' | 'not-found'> {
  if (!SCOPE_PATH.test(scopeRelPath) || scopeRelPath.includes('..')) return 'not-found';
  const path = join(worktree, scopeRelPath);
  let scope: unknown;
  try {
    scope = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return 'not-found';
  }
  const plan = isRecord(scope) ? scope.plan : undefined;
  const items = isRecord(plan) && Array.isArray(plan.items) ? plan.items : [];
  const item = items.find(entry => isRecord(entry) && entry.id === itemId);
  const disposition = isRecord(item) ? item['x-directive/disposition'] : undefined;
  if (!isRecord(disposition)) return 'not-found';
  const provenance = disposition.provenance;
  if (isRecord(provenance) && typeof provenance.kind === 'string' && HUMAN_PROVENANCE_KINDS.has(provenance.kind)) {
    return 'not-needed';
  }
  disposition.provenance = { kind: 'human-event', actor };
  disposition.recorded_at = now.toISOString();
  const temp = join(dirname(path), `.${process.pid}.${Date.now()}.signoff.tmp`);
  await writeFile(temp, `${JSON.stringify(scope, null, 2)}\n`, 'utf8');
  await rename(temp, path);
  return 'signed';
}
