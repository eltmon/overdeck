// The conversation's diff window: the standalone /popout/diff route with the
// full DiffPanel (All turns, per-turn chips, vs main, Compare…, whitespace,
// Markdown preview). PAN-5295 D2-4: the ⋯ menu and the turn card outside a
// Stage open it here, the same URL DiffPanel's own pop-out button builds.

import type { Conversation } from '../CommandDeck/ConversationList';

type DiffWindowConversation = Pick<Conversation, 'name' | 'cwd'>;

export interface DiffWindowOptions {
  /** Repo path of the file the window selects first. */
  filePath?: string;
  /** Explorer root for the window's Open file actions. */
  rootId?: string | null;
}

/** D2-2: conversations whose changes the panel can query (real rows, not linked or vault copies). */
export function hasConversationChanges(conversation: Pick<Conversation, 'id' | 'origin'>): boolean {
  return conversation.id >= 0 && conversation.origin !== 'linked' && conversation.origin !== 'vault';
}

export function conversationDiffWindowUrl(conversation: DiffWindowConversation, opts: DiffWindowOptions = {}): string {
  const params = new URLSearchParams();
  params.set('diff', '1');
  params.set('prefix', `/api/conversations/${encodeURIComponent(conversation.name)}/diffs`);
  params.set('agentId', conversation.name);
  if (conversation.cwd) params.set('repo', conversation.cwd);
  if (opts.rootId) params.set('root', opts.rootId);
  if (opts.filePath) params.set('diffFilePath', opts.filePath);
  return `/popout/diff?${params.toString()}`;
}

export function openConversationDiffWindow(conversation: DiffWindowConversation, opts: DiffWindowOptions = {}): void {
  window.open(conversationDiffWindowUrl(conversation, opts), '_blank', 'width=1000,height=800');
}
