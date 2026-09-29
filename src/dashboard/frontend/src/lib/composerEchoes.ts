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

const normalizeWs = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Four passes over the still-unmatched entries (PAN-4247, PAN-4305): (1) match
 * each new user echo 1:1, retaining IDs across partial snapshots and failed
 * sends, comparing with whitespace collapsed so attachment references joined
 * by a space still match a bubble that joined them with a newline; (2) for
 * what's left, check whether Claude Code joined two or more quick sends into
 * one queued message that matches neither bubble individually, also with
 * whitespace collapsed; (3) for what's still left, check whether its full
 * text is contained in a later user record (a merged queued prompt whose
 * extra content defeats an exact or joined-run match); (4) for what's still
 * left after that, check whether it instead routed into a running subagent. A
 * later main-transcript echo still wins over a subagent match, since pass (4)
 * never removes the entry from `optimistic`.
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
      if (normalizeWs(message.text) !== normalizeWs(local.text)) return false;
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
      const candidateText = normalizeWs(message.text);
      const available = remaining.filter((entry) => !joinedMatchedIds.has(entry.id));
      for (let start = 0; start < available.length; start += 1) {
        if (Date.parse(message.createdAt) < Date.parse(available[start]!.createdAt)) continue;
        for (let end = start + 2; end <= available.length; end += 1) {
          const run = available.slice(start, end);
          const runTexts = run.map((entry) => normalizeWs(entry.text));
          const joins = ['', '\n', ' '].some((sep) => candidateText === normalizeWs(runTexts.join(sep)));
          if (!joins) continue;
          for (const entry of run) joinedMatchedIds.add(entry.id);
          used.add(message.id);
          continue messageLoop;
        }
      }
    }
  }

  const postJoinOptimistic = singleEchoOptimistic.filter((message) => !joinedMatchedIds.has(message.id));
  const postJoinFailed = singleEchoFailed.filter((message) => !joinedMatchedIds.has(message.id));

  // A still-unmatched entry can be fully contained in a later user record (a
  // merged queued prompt whose extra content defeats passes 1-2, PAN-4305).
  // One record may clear several entries; a message id claimed here stays
  // available to later entries in this same pass but is otherwise `used`.
  const containmentMatchedIds = new Set<string>();
  const claimedByContainment = new Set<string>();
  {
    const remaining = [...postJoinOptimistic, ...postJoinFailed.filter((message) => message.kind === 'prompt')]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const local of remaining) {
      const baseline = new Set(local.echoBaselineIds);
      const localNorm = normalizeWs(local.text);
      if (!localNorm) continue;
      const hit = messages.find((message) => {
        if (message.role !== 'user') return false;
        if (baseline.has(message.id)) return false;
        if (used.has(message.id) && !claimedByContainment.has(message.id)) return false;
        if (message.clientMessageId && local.clientMessageId) return false;
        if (Date.parse(message.createdAt) < Date.parse(local.createdAt)) return false;
        return normalizeWs(message.text).includes(localNorm);
      });
      if (!hit) continue;
      used.add(hit.id);
      claimedByContainment.add(hit.id);
      containmentMatchedIds.add(local.id);
    }
  }

  const optimistic = postJoinOptimistic.filter((message) => !containmentMatchedIds.has(message.id));
  const failed = postJoinFailed.filter((message) => !containmentMatchedIds.has(message.id));

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

  if (matched.size === 0 && joinedMatchedIds.size === 0 && containmentMatchedIds.size === 0 && !subagentChanged) {
    return state;
  }
  return {
    ...state,
    optimistic: reconciled,
    failed,
    consumedEchoIds: [...used],
  };
}
