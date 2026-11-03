/**
 * Answer a Deft escalation (PAN-4849 WI-3, PAN-4820 AD-10).
 *
 * Deft's agent polls `.deft/escalations/<id>.json`. Overdeck resolves an
 * escalation the way `deft escalation:resolve` does, without running a Deft
 * CLI: it rewrites the file in place with `status: "resolved"` and a filled
 * `resolution`, atomically (temp file in the same directory, then rename).
 * It then tells the issue's work agent, as the fallback the issue names.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deliverAgentMessage } from '../agents/delivery.js';

export const DEFT_ESCALATION_DECISIONS = ['approved', 'denied', 'answered', 'dismissed'] as const;
export type DeftEscalationDecision = (typeof DEFT_ESCALATION_DECISIONS)[number];

const ESCALATION_ID = /^esc-[0-9]{14}-[0-9a-f]{6}$/;

export interface DeftEscalationAnswer {
  decision: DeftEscalationDecision;
  answer?: string;
  note?: string;
  actor: string;
}

export function isDeftEscalationId(escId: string): boolean {
  return ESCALATION_ID.test(escId);
}

export async function resolveDeftEscalation(
  worktree: string,
  escId: string,
  input: DeftEscalationAnswer,
  now: Date = new Date(),
): Promise<'resolved' | 'already-resolved' | 'not-found'> {
  if (!isDeftEscalationId(escId)) return 'not-found';
  const dir = join(worktree, '.deft', 'escalations');
  const path = join(dir, `${escId}.json`);
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not-found';
    record = parsed as Record<string, unknown>;
  } catch {
    return 'not-found';
  }
  if (record.status === 'resolved') return 'already-resolved';
  const next = {
    ...record,
    status: 'resolved',
    resolution: {
      decision: input.decision,
      resolvedAt: now.toISOString(),
      resolvedBy: input.actor,
      note: input.note ?? null,
      answer: input.answer ?? null,
    },
  };
  const temp = join(dir, `.${escId}.${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temp, path);
  return 'resolved';
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
