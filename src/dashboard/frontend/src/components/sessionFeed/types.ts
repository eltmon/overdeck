import type { IssueId, LaneActivity } from '@overdeck/contracts';

export type SessionFeedTab = 'all' | 'chats' | 'files' | 'git' | 'comments' | 'activity';

export type SessionFeedEntryKind = 'conversation' | 'activity' | 'gauntlet_run' | 'git' | 'file_change' | 'comment' | 'placeholder';

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
  /** Recency timestamp (lastActivityAt ?? lastAttachedAt ?? createdAt); the Chats tab dates by it. */
  recencyAt: string;
  /** Which fact `timestamp` records. */
  timestampLabel: 'started' | 'ended' | 'active';
  sessionAlive: boolean;
  /** FR-5 derived status dot. */
  agentState: 'active' | 'waiting' | 'idle';
  projectKey: string | null;
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
  /**
   * Lifecycle status token for memory observations (e.g. `blocked`, `done`,
   * `in_progress`). Rendered as a small chip beside the headline. Absent for
   * operational entries.
   */
  statusLabel?: string;
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
  /** FR-14: number of entries for this issue collapsed into this card (1 when not collapsed). */
  stepCount?: number;
}

export interface GauntletRunLane {
  id: number;
  name: string;
  key: string;
  role: 'builder' | 'critic' | 'verifier' | 'play' | 'orchestrator';
  iteration: number | null;
  activity: LaneActivity;
  report: { status: string; at: string; verdict: string | null } | null;
  criticOfConversationId: number | null;
  createdAt: string;
}

/**
 * PAN-4301: one card per gauntlet run — the lanes sharing (projectKey, gauntletRun).
 * `id` is `gauntlet-run:<projectKey ?? '-'>:<run>`; `timestamp` = `latest.at`;
 * `issueId` and `workspaceId` are null.
 */
export interface GauntletRunSessionFeedEntry extends SessionFeedEntryBase {
  kind: 'gauntlet_run';
  run: string;
  projectKey: string | null;
  orchestratorName: string | null;
  orchestratorTitle: string | null;
  countsLine: string;
  state: 'needs-you' | 'failed' | 'working' | 'idle' | 'stopped';
  latest: { text: string; at: string };
  /** Ordered per FR-12. */
  lanes: GauntletRunLane[];
  laneConversationIds: number[];
  anyAlive: boolean;
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
  | GauntletRunSessionFeedEntry
  | GitSessionFeedEntry
  | FileChangeSessionFeedEntry
  | CommentSessionFeedEntry
  | PlaceholderSessionFeedEntry;
