/**
 * Answers to Deft's dashboard questions (PAN-4849 WI-4, FR-14).
 *
 * The dialog's answer to a `deft-escalation:<id>` question resolves the
 * escalation file and tells the work agent; the answer to a `deft-menu:`
 * question is delivered as the exact option label (WI-5). Split from
 * `pending.ts` so the enrichment, which imports the read side, does not
 * import agent delivery (an import cycle through `agents/delivery.ts`).
 */
import { deliverAgentMessage } from '../agents/delivery.js';
import { type DeftEscalationDecision, notifyEscalationResolved, resolveDeftEscalation } from './escalations.js';
import { clearDeftPendingCache, DEFT_ESCALATION_TOOL_ID_PREFIX, type DeftPendingDeps, deftIssueForAgent } from './pending.js';

const NOTE_SUFFIX = /\n\nNote: ([\s\S]*)$/;
const LABEL_DECISIONS: Record<string, DeftEscalationDecision> = { Approve: 'approved', Deny: 'denied', Dismiss: 'dismissed' };

/**
 * BD-9: the question dialog sends either `[note]` or the picked label with
 * `\n\nNote: <note>` appended. A bare Approve/Deny/Dismiss is that decision;
 * anything else is an `answered` decision carrying the full text.
 */
export function mapDeftEscalationAnswer(text: string): { decision: DeftEscalationDecision; answer?: string; note?: string } {
  const match = NOTE_SUFFIX.exec(text);
  const note = match ? match[1]!.trim() : '';
  const remainder = (match ? text.slice(0, match.index) : text).trim();
  const decision = LABEL_DECISIONS[remainder];
  if (decision) return note ? { decision, note } : { decision };
  return { decision: 'answered', answer: [remainder, note].filter(Boolean).join('\n\n') };
}

/** Answer a `deft-escalation:<id>` question from the dialog. */
export async function answerDeftEscalation(
  agentId: string,
  toolId: string,
  answer: string,
  deps: DeftPendingDeps = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const target = await deftIssueForAgent(agentId, deps);
  if (!target) return { status: 404, body: { error: `${agentId} is not a Deft work agent` } };
  const escId = toolId.slice(DEFT_ESCALATION_TOOL_ID_PREFIX.length);
  const mapped = mapDeftEscalationAnswer(answer);
  const outcome = await resolveDeftEscalation(target.worktree, escId, { ...mapped, actor: 'operator:dashboard' });
  clearDeftPendingCache(target.worktree);
  if (outcome === 'not-found') return { status: 404, body: { error: `no escalation ${escId}` } };
  if (outcome === 'already-resolved') {
    return { status: 409, body: { error: `escalation ${escId} is already resolved`, code: 'decision-closed' } };
  }
  const delivery = await notifyEscalationResolved(target.issueId, escId, mapped.decision, mapped.answer);
  return {
    status: 200,
    body: {
      success: true,
      agentId,
      resolved: true,
      delivered: delivery.delivered ? 1 : 0,
      ...(delivery.failure ? { deliveryError: delivery.failure } : {}),
    },
  };
}

const MENU_REFUSAL = "Deft menus take one option; reply in the terminal for anything else";

/**
 * BD-10: a `deft-menu:` answer must be exactly one option label (a trailing
 * `\n\nNote: …` is dropped). The agent receives the label alone, verbatim,
 * because Deft accepts only the displayed number or the exact label.
 */
export async function answerDeftMenu(
  agentId: string,
  _toolId: string,
  answer: string,
  options: string[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const match = NOTE_SUFFIX.exec(answer);
  const label = (match ? answer.slice(0, match.index) : answer).trim();
  if (!options.includes(label)) return { status: 400, body: { error: MENU_REFUSAL } };
  const result = await deliverAgentMessage(agentId, label, 'deft-menu-answer');
  if (!result.ok) return { status: 502, body: { error: result.failure ?? 'delivery failed', code: 'delivery-failed' } };
  return { status: 200, body: { success: true, agentId, delivered: 1 } };
}
