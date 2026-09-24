import type { Conversation } from '../CommandDeck/ConversationList';
import type { Harness } from './ModelPicker';

export async function resumeConversation(
  name: string,
  model?: string,
  effort?: string,
  harness?: Harness,
  sendResumeContract = true,
): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, effort, harness, sendResumeContract }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Failed to resume conversation (${res.status})`);
  }
  return res.json();
}
