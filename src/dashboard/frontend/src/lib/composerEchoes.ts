import type { ChatMessage, FailedMessage, SubagentSummary } from '../components/chat/chat-types';

export interface SendIdentity {
  clientMessageId?: string;
  echoBaselineIds?: string[];
  createdAt?: string;
}

interface EchoState {
  optimistic: ChatMessage[];
  failed: FailedMessage[];
  consumedEchoIds: string[];
}

const normalizeText = (text: string) => text.replace(/\r\n/g, '\n').trim();
const normalizeWs = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Match each new user echo once, retaining IDs across partial snapshots and
 * failed sends, then — for anything the main transcript still hasn't
 * claimed — check whether Claude Code instead routed it into a running
 * subagent (PAN-4247). A later main-transcript echo still wins over a
 * subagent match, since this pass never removes the entry from `optimistic`.
 */
export function reconcileComposerEchoes<T extends EchoState>(
  state: T,
  messages: ChatMessage[],
  subagents: SubagentSummary[] = [],
): T {
  const used = new Set(state.consumedEchoIds);
  const matched = new Set<string>();
  const pending = [...state.optimistic, ...state.failed.filter((message) => message.kind === 'prompt')]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const local of pending) {
    const baseline = new Set(local.echoBaselineIds);
    const echo = messages.find((message) => {
      if (message.role !== 'user' || used.has(message.id)) return false;
      if (message.clientMessageId && local.clientMessageId) return message.clientMessageId === local.clientMessageId;
      if (baseline.has(message.id)) return false;
      if (normalizeText(message.text) !== normalizeText(local.text)) return false;
      // Text alone cannot distinguish an older same-text turn loaded later.
      return Date.parse(message.createdAt) >= Date.parse(local.createdAt);
    });
    if (echo) {
      used.add(echo.id);
      matched.add(local.id);
    }
  }

  const optimistic = state.optimistic.filter((message) => !matched.has(message.id));
  const failed = state.failed.filter((message) => !matched.has(message.id));

  const humanInputs = subagents.flatMap((subagent) =>
    (subagent.humanInputs ?? []).map((input) => ({ input, subagent })));
  let subagentChanged = false;
  const reconciled = humanInputs.length === 0 ? optimistic : optimistic.map((local) => {
    if (local.deliveryState === 'subagent') return local;
    const hit = humanInputs.find(({ input }) =>
      !used.has(input.id)
      && Date.parse(input.createdAt) >= Date.parse(local.createdAt)
      && normalizeWs(input.text).includes(normalizeWs(local.text)));
    if (!hit) return local;
    used.add(hit.input.id);
    subagentChanged = true;
    return {
      ...local,
      acknowledged: true,
      deliveryState: 'subagent' as const,
      deliveredToSubagent: { agentId: hit.subagent.agentId, description: hit.subagent.description },
    };
  });

  if (matched.size === 0 && !subagentChanged) return state;
  return {
    ...state,
    optimistic: reconciled,
    failed,
    consumedEchoIds: [...used],
  };
}
