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
 * Three passes over the still-unmatched entries (PAN-4247): (1) match each new
 * user echo 1:1, retaining IDs across partial snapshots and failed sends;
 * (2) for what's left, check whether Claude Code joined two or more quick
 * sends into one queued message that matches neither bubble individually;
 * (3) for what's still left, check whether it instead routed into a running
 * subagent. A later main-transcript echo still wins over a subagent match,
 * since pass (3) never removes the entry from `optimistic`.
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

  const singleEchoOptimistic = state.optimistic.filter((message) => !matched.has(message.id));
  const singleEchoFailed = state.failed.filter((message) => !matched.has(message.id));

  // Two quick sends can be joined by Claude Code into one queued message that
  // matches neither bubble individually (PAN-4247). Try contiguous runs of the
  // still-unmatched entries against each unclaimed main 'user' message before
  // falling back to the per-message subagent check below.
  const joinedMatchedIds = new Set<string>();
  {
    const remaining = [...singleEchoOptimistic, ...singleEchoFailed.filter((message) => message.kind === 'prompt')]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const allBaselineIds = new Set(remaining.flatMap((entry) => entry.echoBaselineIds ?? []));
    messageLoop: for (const message of messages) {
      if (message.role !== 'user' || used.has(message.id) || allBaselineIds.has(message.id)) continue;
      const candidateText = normalizeText(message.text);
      const available = remaining.filter((entry) => !joinedMatchedIds.has(entry.id));
      for (let start = 0; start < available.length; start += 1) {
        if (Date.parse(message.createdAt) < Date.parse(available[start]!.createdAt)) continue;
        for (let end = start + 2; end <= available.length; end += 1) {
          const run = available.slice(start, end);
          const runTexts = run.map((entry) => normalizeText(entry.text));
          const joins = ['', '\n', ' '].some((sep) => candidateText === normalizeText(runTexts.join(sep)));
          if (!joins) continue;
          for (const entry of run) joinedMatchedIds.add(entry.id);
          used.add(message.id);
          continue messageLoop;
        }
      }
    }
  }

  const optimistic = singleEchoOptimistic.filter((message) => !joinedMatchedIds.has(message.id));
  const failed = singleEchoFailed.filter((message) => !joinedMatchedIds.has(message.id));

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

  if (matched.size === 0 && joinedMatchedIds.size === 0 && !subagentChanged) return state;
  return {
    ...state,
    optimistic: reconciled,
    failed,
    consumedEchoIds: [...used],
  };
}
