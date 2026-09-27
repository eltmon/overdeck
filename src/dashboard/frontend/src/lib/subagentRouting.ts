import type { ChatMessage, SubagentSummary } from '../components/chat/chat-types';

/**
 * Claude Code writes a background subagent's completion as a
 * `<task-notification>` record, which subagent relays land in the main
 * transcript too — that landing must never be mistaken for a main-transcript
 * user turn that clears the routed notice (PAN-4247).
 */
const TASK_NOTIFICATION_PREFIX = '<task-notification>';

/**
 * Composer notice for input Claude Code has routed, or may route, into a
 * running subagent instead of the main conversation (PAN-4247).
 */
export type SubagentRoutingNotice = {
  kind: 'routed' | 'running';
  key: string;
  agentId: string;
  description: string;
} | null;

/**
 * `'routed'` when the newest human-origin sidechain input across every
 * subagent is newer than the newest real main-transcript user turn (an
 * optimistic bubble doesn't count, and neither does a subagent's own
 * task-notification relay); else `'running'` for the first background
 * subagent still running; else `null`.
 */
export function subagentRoutingNotice(subagents: SubagentSummary[], messages: ChatMessage[]): SubagentRoutingNotice {
  let newestHuman: { id: string; createdAt: string; agentId: string; description: string } | null = null;
  for (const subagent of subagents) {
    for (const input of subagent.humanInputs ?? []) {
      if (!newestHuman || Date.parse(input.createdAt) > Date.parse(newestHuman.createdAt)) {
        newestHuman = { id: input.id, createdAt: input.createdAt, agentId: subagent.agentId, description: subagent.description };
      }
    }
  }

  if (newestHuman) {
    let newestMainUserAt = -Infinity;
    for (const message of messages) {
      if (message.role !== 'user' || message.id.startsWith('optimistic-')) continue;
      if (message.text.startsWith(TASK_NOTIFICATION_PREFIX)) continue;
      const at = Date.parse(message.createdAt);
      if (at > newestMainUserAt) newestMainUserAt = at;
    }
    if (Date.parse(newestHuman.createdAt) > newestMainUserAt) {
      return { kind: 'routed', key: newestHuman.id, agentId: newestHuman.agentId, description: newestHuman.description };
    }
  }

  const runningBackground = subagents.find((subagent) => subagent.background === true && subagent.status === 'running');
  if (runningBackground) {
    return { kind: 'running', key: runningBackground.agentId, agentId: runningBackground.agentId, description: runningBackground.description };
  }

  return null;
}
