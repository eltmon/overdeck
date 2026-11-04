/**
 * Answer a Deft escalation (PAN-4849 WI-3, PAN-4820 AD-10).
 *
 * Deft's agent polls `.deft/escalations/<id>.json`. Overdeck resolves an
 * escalation the way `deft escalation:resolve` does, without running a Deft
 * CLI: it rewrites the file in place with `status: "resolved"` and a filled
 * `resolution`, atomically (a uniquely named temp file in the same directory,
 * then rename). It then tells the issue's work agent, as the fallback the
 * issue names.
 *
 * The id is Deft's, and `deft escalation:file --id <custom>` allows any id, so
 * the file is found by the `id` parsed from it, as the state reader lists it.
 * The id is checked for path characters first, and a file whose real path is
 * not directly inside `.deft/escalations/` (a symlink out) is never read.
 * Resolves of one escalation run one at a time in this process, so the second
 * of two concurrent answers sees `already-resolved`.
 */
import { randomBytes } from 'node:crypto';
import { readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { deliverAgentMessage } from '../agents/delivery.js';

export const DEFT_ESCALATION_DECISIONS = ['approved', 'denied', 'answered', 'dismissed'] as const;
export type DeftEscalationDecision = (typeof DEFT_ESCALATION_DECISIONS)[number];

const MAX_ID_LENGTH = 200;

export interface DeftEscalationAnswer {
  decision: DeftEscalationDecision;
  answer?: string;
  note?: string;
  actor: string;
}

/** An id that cannot name a path outside its directory: no separators, no `..`, no NUL. */
export function isSafeDeftEscalationId(escId: string): boolean {
  return escId.length > 0 && escId.length <= MAX_ID_LENGTH && !/[/\\\0]/.test(escId) && !escId.includes('..');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The escalation file whose parsed `id` is `escId`, checked to sit directly in the directory. */
async function findEscalationFile(dir: string, escId: string): Promise<{ path: string; record: Record<string, unknown> } | null> {
  let realDir: string;
  let names: string[];
  try {
    realDir = await realpath(dir);
    names = (await readdir(realDir)).filter(name => name.endsWith('.json')).sort();
  } catch {
    return null;
  }
  // Deft names the file <id>.json; try that first, then any file carrying the id.
  const own = `${escId}.json`;
  const ordered = names.includes(own) ? [own, ...names.filter(name => name !== own)] : names;
  for (const name of ordered) {
    try {
      const path = await realpath(join(realDir, name));
      if (dirname(path) !== realDir) continue;
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (isRecord(parsed) && parsed.id === escId) return { path, record: parsed };
    } catch {
      // Unreadable or malformed: not this escalation.
    }
  }
  return null;
}

const resolveLocks = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier call with the same key has settled. */
async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (resolveLocks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  resolveLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (resolveLocks.get(key) === tail) resolveLocks.delete(key);
  }
}

export async function resolveDeftEscalation(
  worktree: string,
  escId: string,
  input: DeftEscalationAnswer,
  now: Date = new Date(),
): Promise<'resolved' | 'already-resolved' | 'not-found'> {
  if (!isSafeDeftEscalationId(escId)) return 'not-found';
  const dir = join(worktree, '.deft', 'escalations');
  return serialized(`${dir}\0${escId}`, async () => {
    const found = await findEscalationFile(dir, escId);
    if (!found) return 'not-found';
    if (found.record.status === 'resolved') return 'already-resolved';
    const next = {
      ...found.record,
      status: 'resolved',
      resolution: {
        decision: input.decision,
        resolvedAt: now.toISOString(),
        resolvedBy: input.actor,
        note: input.note ?? null,
        answer: input.answer ?? null,
      },
    };
    const temp = join(dirname(found.path), `.${basename(found.path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temp, found.path);
    return 'resolved';
  });
}

/** Tell the issue's work agent that an escalation was answered. Never throws. */
export async function notifyEscalationResolved(
  issueId: string,
  escId: string,
  decision: DeftEscalationDecision,
  answer?: string,
): Promise<{ delivered: boolean; failure?: string }> {
  const message = `Operator resolved Deft escalation ${escId}: ${decision}${answer ? ` — ${answer}` : ''}`;
  try {
    const result = await deliverAgentMessage(`agent-${issueId.toLowerCase()}`, message, 'deft-escalation-answer');
    return result.ok ? { delivered: true } : { delivered: false, failure: result.failure ?? 'delivery failed' };
  } catch (error) {
    return { delivered: false, failure: (error as Error).message };
  }
}
