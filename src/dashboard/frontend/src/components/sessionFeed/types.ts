import type { IssueId } from '@overdeck/contracts';

export type SessionFeedTab = 'all' | 'chats' | 'files' | 'git' | 'comments' | 'activity';

export type SessionFeedEntryKind = 'conversation' | 'activity' | 'git' | 'file_change' | 'comment' | 'placeholder';

export interface SessionFeedEntryBase {
  id: string;
  timestamp: string;
  workspaceId: string | null;
  issueId: IssueId | null;
}

export interface ConversationSessionFeedEntry extends SessionFeedEntryBase {
  kind: 'conversation';
  conversationId: number;
  conversationName: string;
  agent: string;
  lastMessageDate: string;
  lastMessageSnippet: string;
  messageCount?: number;
  threadLabel?: string;
  threadIsPrimary?: boolean;
}

export interface ActivitySessionFeedEntry extends SessionFeedEntryBase {
  kind: 'activity';
  /**
   * Which class this activity entry came from. Both operational pipeline events
   * and AI memory observations are folded into `kind: 'activity'` (see
   * useActivityEntryFeed / useObservationFeed), which made them indistinguishable
   * in the feed. This discriminator drives the per-card class badge. Defaults to
   * 'operational' when absent (older cached entries).
   */
  activityClass?: 'operational' | 'memory';
  headline: string;
  summary: string;
  narrative?: string;
  files?: readonly string[];
  tags?: readonly string[];
  /** Dashboard route to navigate to on click; takes precedence over issueId routing. */
  link?: string;
  /**
   * System-level news (dashboard restarts, supervisor watchdog actions) —
   * shown in every feed scope, never filtered out by project issue scoping.
   */
  systemWide?: boolean;
}

export interface GitSessionFeedEntry extends SessionFeedEntryBase {
  kind: 'git';
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string | null;
  category?: string | null;
  triggeringEvent?: string | null;
}

export interface FileChangeSessionFeedEntry extends SessionFeedEntryBase {
  kind: 'file_change';
  path: string;
  changeKind?: 'added' | 'modified' | 'deleted' | 'renamed';
  summary?: string;
}

export interface CommentSessionFeedEntry extends SessionFeedEntryBase {
  kind: 'comment';
  author?: string;
  body: string;
  url?: string;
}

export interface PlaceholderSessionFeedEntry extends SessionFeedEntryBase {
  kind: 'placeholder';
  tab: Extract<SessionFeedTab, 'files' | 'comments'>;
  label: string;
  description: string;
}

export type SessionFeedEntry =
  | ConversationSessionFeedEntry
  | ActivitySessionFeedEntry
  | GitSessionFeedEntry
  | FileChangeSessionFeedEntry
  | CommentSessionFeedEntry
  | PlaceholderSessionFeedEntry;
