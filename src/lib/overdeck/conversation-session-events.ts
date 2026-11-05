/**
 * In-process notification that a conversation's current Claude session changed
 * (PAN-2652). Fired by the write door (setConversationClaudeSessionId) only when
 * the current locator actually changed; the live transcript stream listens so an
 * open Conversation tab follows forks without a reload.
 */
type Listener = (sessionId: string) => void;
const listeners = new Map<string, Set<Listener>>();

export function onConversationSessionChanged(name: string, listener: Listener): () => void {
  const set = listeners.get(name) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(name, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(name);
  };
}

export function notifyConversationSessionChanged(name: string, sessionId: string): void {
  for (const listener of [...(listeners.get(name) ?? [])]) {
    try { listener(sessionId); } catch { /* a listener failure never breaks the write door */ }
  }
}
