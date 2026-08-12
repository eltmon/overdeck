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
  if (!res.ok) throw new Error('Failed to resume conversation');
  return res.json();
}
