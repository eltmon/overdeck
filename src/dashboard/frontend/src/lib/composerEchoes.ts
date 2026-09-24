import type { ChatMessage, FailedMessage } from '../components/chat/chat-types';

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

/** Match each new user echo once, retaining IDs across partial snapshots and failed sends. */
export function reconcileComposerEchoes<T extends EchoState>(state: T, messages: ChatMessage[]): T {
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
  if (matched.size === 0) return state;
  return {
    ...state,
    optimistic: state.optimistic.filter((message) => !matched.has(message.id)),
    failed: state.failed.filter((message) => !matched.has(message.id)),
    consumedEchoIds: [...used],
  };
}
