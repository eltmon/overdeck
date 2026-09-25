/**
 * Prompt guard (PAN-3917 FR-17).
 *
 * On 2026-09-18 the MIN-1039 work agent received the same review-result
 * message four to five times within minutes, and changed course on claims sent
 * to it by reviewer conversations that had no authority to steer it. Two rules
 * follow, and both adapters run them inside `prompt`:
 *
 *  1. **Idempotence.** Every prompt carries a message id. A repeat of the same
 *     id for the same target inside a bounded window is dropped, not delivered.
 *  2. **Authority.** A pane whose tokens say issue X and role `worker` accepts
 *     prompts only from the pane whose tokens say issue X and role `work`
 *     (its foreman), from the sender whose id equals the pane's `parent` token
 *     (the agent or conversation that ran `pan worker run`, PAN-3920), or from
 *     an operator conversation — a sender id starting `conv-` that carries no
 *     `issue` token. Any other sender is refused with a reason.
 *
 * The ring is in memory and per process: it de-duplicates inside the long-lived
 * dashboard server, which is where the repeated deliveries came from. Two
 * separate short-lived CLI invocations cannot see each other's ids.
 */

import type { AgentRole, PaneTokens, PromptSender } from './types.js';

/**
 * Overdeck's own role vocabulary is wider than the pane-token roles (FR-5).
 * `ship` is the UAT/ship specialist; the singleton runners (`flywheel`,
 * `sequencer`, `knowledge`) are operator-side and carry no issue token, so they
 * never reach a role-gated target.
 */
export function toPaneRole(role: string | undefined): AgentRole {
  switch (role) {
    case 'work':
    case 'review':
    case 'test':
    case 'strike':
    case 'plan':
    case 'worker':
    case 'uat':
    case 'conversation':
      return role;
    case 'ship':
      return 'uat';
    default:
      return 'work';
  }
}

/**
 * The pane tokens derived from an agent's launch metadata. This is where a
 * tmux target's tokens come from — a tmux pane carries none of its own.
 */
export function tokensFromLaunchMetadata(
  state: { issueId?: string; role?: string; harness?: string; model?: string; parentId?: string } | null | undefined,
): Partial<PaneTokens> {
  if (!state) return {};
  return {
    issue: state.issueId,
    role: toPaneRole(state.role),
    harness: state.harness ?? 'claude-code',
    model: state.model ?? 'unknown',
    ...(state.parentId ? { parent: state.parentId } : {}),
  };
}

/** How many recent message ids are remembered per target. */
const PROMPT_RING_SIZE = 64;

/** How long a remembered id suppresses a repeat. */
export const PROMPT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/** How many targets the guard remembers before evicting the least recent. */
const MAX_TRACKED_TARGETS = 256;

export type PromptGuardVerdict =
  | { readonly allow: true }
  | { readonly dropped: true; readonly reason: string }
  | { readonly refused: true; readonly reason: string };

export interface PromptGuardInput {
  /** Backend-native target handle (Herdr pane id / agent name, tmux session). */
  readonly targetId: string;
  /** The target's metadata tokens, as the backend reports them. */
  readonly targetTokens: Partial<PaneTokens>;
  /**
   * False when the backend could not be asked what this target is (an
   * `agent.get` that errored, a pane that is gone). Absent tokens and unknown
   * tokens are different facts; only the first means "ungated".
   */
  readonly targetTokensAvailable?: boolean;
  readonly sender: PromptSender;
  readonly messageId: string;
  readonly now?: number;
}

interface TargetRing {
  /** messageId → timestamp, in insertion order. */
  readonly seen: Map<string, number>;
}

const rings = new Map<string, TargetRing>();

/** Drop every remembered id. Tests call this between cases. */
export function resetPromptGuard(): void {
  rings.clear();
}

function ringFor(targetId: string): TargetRing {
  const existing = rings.get(targetId);
  if (existing) {
    // Refresh LRU position.
    rings.delete(targetId);
    rings.set(targetId, existing);
    return existing;
  }
  const ring: TargetRing = { seen: new Map() };
  rings.set(targetId, ring);
  while (rings.size > MAX_TRACKED_TARGETS) {
    const oldest = rings.keys().next().value;
    if (oldest === undefined) break;
    rings.delete(oldest);
  }
  return ring;
}

/** An operator conversation: a `conv-` sender that carries no issue token. */
export function isOperatorConversation(sender: PromptSender): boolean {
  return sender.id.toLowerCase().startsWith('conv-') && !sender.issue;
}

function sameIssue(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/**
 * The authority half of FR-17. Only `worker` panes are gated: they are the
 * item panes a foreman dispatches, and the incident was a reviewer steering
 * one. Every other role keeps today's open delivery.
 *
 * `tokensAvailable: false` means the backend could not say what the target is.
 * The guard cannot then prove the target is NOT a worker pane, so it refuses
 * everyone but an operator — a human at a conversation always keeps the ability
 * to steer, and an agent never gains one it could not be granted.
 */
function checkPromptAuthority(
  targetTokens: Partial<PaneTokens>,
  sender: PromptSender,
  tokensAvailable = true,
): PromptGuardVerdict {
  if (isOperatorConversation(sender)) return { allow: true };
  if (!tokensAvailable) {
    return {
      refused: true,
      reason:
        `the backend could not report what ${sender.id}'s target is, so its role cannot be checked; `
        + 'only an operator conversation may prompt a target with unknown metadata.',
    };
  }
  if (targetTokens.role !== 'worker') return { allow: true };

  const issue = targetTokens.issue;
  if (sender.role === 'work' && sameIssue(sender.issue, issue)) return { allow: true };
  // PAN-3920: the agent or conversation that spawned this worker may steer it.
  if (targetTokens.parent && sender.id.toLowerCase() === targetTokens.parent.toLowerCase()) return { allow: true };

  const senderRole: AgentRole | 'unknown' = sender.role ?? 'unknown';
  const senderIssue = sender.issue ?? 'no issue';
  return {
    refused: true,
    reason:
      `${sender.id} (role ${senderRole}, ${senderIssue}) may not prompt a worker pane of ` +
      `${issue ?? 'an unknown issue'}: only that issue's work pane, the worker's parent, or an operator conversation may.`,
  };
}

/**
 * Run both halves. Authority first, so a refused message never occupies a slot
 * in the target's ring.
 */
export function checkPrompt(input: PromptGuardInput): PromptGuardVerdict {
  const authority = checkPromptAuthority(input.targetTokens, input.sender, input.targetTokensAvailable ?? true);
  if ('refused' in authority) return authority;

  const now = input.now ?? Date.now();
  const ring = ringFor(input.targetId);

  // Expire everything older than the window before deciding.
  for (const [id, at] of ring.seen) {
    if (now - at > PROMPT_DEDUPE_WINDOW_MS) ring.seen.delete(id);
  }

  const seenAt = ring.seen.get(input.messageId);
  if (seenAt !== undefined) {
    return {
      dropped: true,
      reason:
        `message ${input.messageId} was already delivered to ${input.targetId} ` +
        `${Math.round((now - seenAt) / 1000)}s ago`,
    };
  }

  ring.seen.set(input.messageId, now);
  while (ring.seen.size > PROMPT_RING_SIZE) {
    const oldest = ring.seen.keys().next().value;
    if (oldest === undefined) break;
    ring.seen.delete(oldest);
  }
  return { allow: true };
}

/**
 * The sender identity a process speaks with. On tmux (and in the CLI) it is
 * `OVERDECK_AGENT_ID`; a process with none is an operator shell, which is
 * treated as an operator conversation.
 */
export function senderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  lookup: (agentId: string) => { issue?: string; role?: AgentRole } | null = () => null,
): PromptSender {
  const id = env.OVERDECK_AGENT_ID;
  if (!id) return { id: `conv-operator-${process.pid}` };
  const tokens = lookup(id) ?? {};
  return { id, issue: tokens.issue ?? env.OVERDECK_ISSUE_ID, role: tokens.role };
}
