/**
 * Conversations domain — ConversationsResolver (read door) + ConversationWriter (write door)
 * + TranscriptsResolver (shared read door over JSONL index) + TranscriptsWriter (cache-maint).
 *
 * Critical invariant: the backing session files (claude/pi/codex JSONL) are SACRED.
 * ConversationWriter touches only the DB and creates NEW backing files via forkNewFile;
 * it NEVER mutates, truncates, appends-to, or deletes an existing one.
 * TranscriptsResolver has no write methods at all — mechanically enforced by the surface.
 *
 * Writer durability diverges from Issues: conversations have NO git mirror.
 * The DB row IS the source of truth (schema 90-96). ConversationWriter has no Records dep.
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Context, Effect, Schema, Stream } from 'effect';

import type { RuntimeName } from '../runtimes/types.js';
import type {
  ConversationPullRequests, PullRequestKey, PullRequestLink, PullRequestLinkedConversation, PullRequestLinkSource,
} from '@overdeck/contracts';
import { getOverdeckDatabase } from './infra.js';
import { resolveWorkspaceForCwd } from '../workspaces/resolver.js';
import { getEventStore } from '../../dashboard/server/event-store.js';
import { ensureDiscoveredSessionsSchema } from './discovered-sessions.js';
import { readLatestIndexedSessionId } from '../session-history.js';

// ── Local Drizzle table definitions ──────────────────────────────────────────
// Mirror locked schema (docs/overdeck-remodel/overdeck-schema.ts:97-163).
// No FK or index annotations here — those live in the compiled migration only.

// ── Entity schemas ────────────────────────────────────────────────────────────

const ConversationId   = Schema.String.pipe(Schema.brand('ConversationId'));
export type  ConversationId   = typeof ConversationId.Type;

const ConversationName = Schema.String.pipe(Schema.brand('ConversationName'));
export type  ConversationName = typeof ConversationName.Type;

// Includes legacy 'pi' (pre-rename alias for 'ohmypi', see normalizeHarness) so
// decoding old DB rows never throws; 'pi' is never written by current code.
export const Harness     = Schema.Literals(['claude-code', 'pi', 'ohmypi', 'codex', 'acp', 'kimi-code', 'opencode', 'muse']);
export type  Harness     = typeof Harness.Type;

export const TitleSource = Schema.Literals(['manual', 'auto', 'ai', 'ai-refined', 'ai-explicit', 'default']);
export type  TitleSource = typeof TitleSource.Type;

const FavoriteType = Schema.Literals(['conversation', 'project']);
export type  FavoriteType = typeof FavoriteType.Type;

const BackingFile = Schema.Struct({
  harness:   Harness,
  locator:   Schema.String,
  createdAt: Schema.Date,
});
export type BackingFile = typeof BackingFile.Type;

export const Conversation = Schema.Struct({
  id:                  ConversationId,
  name:                ConversationName,
  cwd:                 Schema.String,
  issueId:             Schema.NullOr(Schema.String),
  harness:             Schema.NullOr(Harness),
  model:               Schema.NullOr(Schema.String),
  effort:              Schema.NullOr(Schema.String),
  title:               Schema.NullOr(Schema.String),
  titleSource:         Schema.NullOr(TitleSource),
  createdAt:           Schema.Date,
  archivedAt:          Schema.NullOr(Schema.Date),
  handoffDocPath:      Schema.NullOr(Schema.String),
  handoffTargetConvId: Schema.NullOr(ConversationId),
  clearedToConvId:     Schema.NullOr(ConversationId),
  /** Explicit project assignment override (PAN-1577). Null = fall back to deriving the project from cwd. */
  projectKey:          Schema.NullOr(Schema.String),
  files:               Schema.Array(BackingFile),
});
export type Conversation = typeof Conversation.Type;

export const ConversationFilter = Schema.Struct({
  archived: Schema.optional(Schema.Boolean),
  issueId:  Schema.optional(Schema.String),
});
export type ConversationFilter = typeof ConversationFilter.Type;

const ParsedTranscript = Schema.Struct({
  messages:     Schema.Array(Schema.Unknown),
  messageCount: Schema.Number,
  models:       Schema.Array(Schema.String),
  firstTs:      Schema.NullOr(Schema.Date),
  lastTs:       Schema.NullOr(Schema.Date),
});
export type ParsedTranscript = typeof ParsedTranscript.Type;

const TranscriptSubject = Schema.Union([Conversation, ConversationName]);
export type  TranscriptSubject = typeof TranscriptSubject.Type;

export const Transcript = Schema.Struct({
  backingFilePath: Schema.String,
  sessionId:       Schema.NullOr(Schema.String),
  harness:         Schema.NullOr(Harness),
  workspacePath:   Schema.NullOr(Schema.String),
  messageCount:    Schema.NullOr(Schema.Number),
  models:          Schema.NullOr(Schema.Array(Schema.String)),
  tokenInput:      Schema.NullOr(Schema.Number),
  tokenOutput:     Schema.NullOr(Schema.Number),
  firstTs:         Schema.NullOr(Schema.Date),
  lastTs:          Schema.NullOr(Schema.Date),
  panIssueId:      Schema.NullOr(Schema.String),
  panAgentId:      Schema.NullOr(Schema.String),
});
export type Transcript = typeof Transcript.Type;

// ── Error types ───────────────────────────────────────────────────────────────

class ConversationNotFound extends Schema.TaggedErrorClass<ConversationNotFound>()(
  'ConversationNotFound', { name: ConversationName },
) {}

class AlreadyArchived extends Schema.TaggedErrorClass<AlreadyArchived>()(
  'AlreadyArchived', { name: ConversationName },
) {}

class NotArchived extends Schema.TaggedErrorClass<NotArchived>()(
  'NotArchived', { name: ConversationName },
) {}

// ── Internal sync decoders (known-shape DB rows) ──────────────────────────────

// ── Row type aliases ───────────────────────────────────────────────────────────

// ── Internal row mappers ───────────────────────────────────────────────────────

// ── ConversationsResolver — read door ─────────────────────────────────────────

export class ConversationsResolver extends Context.Service<ConversationsResolver, {
  readonly get:           (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound>;
  readonly list:          (f: ConversationFilter)  => Effect.Effect<ReadonlyArray<Conversation>>;
  readonly getCurrent:    ()                        => Effect.Effect<Conversation, ConversationNotFound>;
  readonly getHandoffDoc: (name: ConversationName)  => Effect.Effect<string, ConversationNotFound>;
  /** PAN-3822: every PR link on a conversation (dismissed included) + the effective one. */
  readonly listPullRequests:   (name: ConversationName) => Effect.Effect<ConversationPullRequests, ConversationNotFound>;
  /** PAN-3822 reverse index: the conversations with a live link to a PR. */
  readonly linkedToPullRequest: (key: PullRequestKey) => Effect.Effect<ReadonlyArray<PullRequestLinkedConversation>>;
}>()('overdeck/ConversationsResolver') {}

// ── TranscriptsResolver — shared read door (JSONL index + sacred file reads) ──
// Read-only: no method writes a backing file or the transcripts index.

export class TranscriptsResolver extends Context.Service<TranscriptsResolver, {
  readonly resolveFiles: (subject: TranscriptSubject) => Effect.Effect<ReadonlyArray<string>>;
  readonly parse:        (subject: TranscriptSubject) => Effect.Effect<ParsedTranscript>;
  readonly serialize:    (subject: TranscriptSubject) => Effect.Effect<string>;
  readonly watch:        (subject: TranscriptSubject) => Stream.Stream<ParsedTranscript>;
  readonly get:          (key: string)             => Effect.Effect<Transcript>;
  readonly list:         (f: ConversationFilter)   => Effect.Effect<ReadonlyArray<Transcript>>;
  readonly stats:        ()                        => Effect.Effect<{ count: number; managed: number }>;
  readonly search:       (query: string)           => Effect.Effect<ReadonlyArray<Transcript>>;
}>()('overdeck/TranscriptsResolver') {}

// ── TranscriptsWriter — cache-maintenance write door ─────────────────────────
// Mutates the `transcripts` index (rebuilt from JSONL); NEVER writes a sacred file.

export class TranscriptsWriter extends Context.Service<TranscriptsWriter, {
  readonly scan:    (dirs?: ReadonlyArray<string>) => Effect.Effect<{ scanned: number }>;
  readonly rebuild: (dirs?: ReadonlyArray<string>) => Effect.Effect<{ scanned: number }>;
  readonly enrich:  (ids?: ReadonlyArray<string>)  => Effect.Effect<{ enriched: number }>;
  readonly embed:   (ids?: ReadonlyArray<string>)  => Effect.Effect<{ embedded: number }>;
}>()('overdeck/TranscriptsWriter') {}

// ── ConversationWriter — write door ───────────────────────────────────────────
// Writes ONLY the DB (conversations / favorites / conversation_files tables) and
// creates NEW backing files via the fork primitive. NEVER mutates an existing file.
// NO Records dependency — the DB row IS the source of truth (no git mirror).

export class ConversationWriter extends Context.Service<ConversationWriter, {
  readonly create: (opts: {
    name: ConversationName; cwd: string; model?: string; effort?: string;
    harness?: Harness; issueId?: string; projectKey?: string; title?: string;
  }) => Effect.Effect<Conversation>;
  readonly archive:       (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound | AlreadyArchived>;
  readonly unarchive:     (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound | NotArchived>;
  readonly setFavorite:   (type: 'conversation' | 'project', itemId: string) => Effect.Effect<void>;
  readonly unsetFavorite: (type: 'conversation' | 'project', itemId: string) => Effect.Effect<void>;
  readonly retitle:       (name: ConversationName, title: string, source: 'manual' | 'auto' | 'ai') =>
    Effect.Effect<Conversation, ConversationNotFound>;
  readonly setModel:   (name: ConversationName, model: string)    => Effect.Effect<Conversation, ConversationNotFound>;
  readonly setHarness: (name: ConversationName, harness: Harness) => Effect.Effect<Conversation, ConversationNotFound>;
  /** Explicit project assignment override (PAN-1577); pass null to clear it back to cwd-derived grouping. */
  readonly setProjectKey: (name: ConversationName, projectKey: string | null) => Effect.Effect<Conversation, ConversationNotFound>;
  /** PAN-3822: explicit PR link (upsert) and unlink (tombstone via dismissed_at). */
  readonly linkPullRequest:   (name: ConversationName, ref: PullRequestKey & { url: string }, source: Exclude<PullRequestLinkSource, 'branch'>) =>
    Effect.Effect<PullRequestLink, ConversationNotFound>;
  readonly unlinkPullRequest: (name: ConversationName, key: PullRequestKey) => Effect.Effect<{ unlinked: boolean }, ConversationNotFound>;
  readonly handoff:     (source: ConversationName, target: ConversationName, docPath: string) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
  readonly clear:       (source: ConversationName) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
  readonly summaryFork: (source: ConversationName, opts: { mode: 'summary' | 'plain'; model?: string }) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
  readonly compact:     (name: ConversationName) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
}>()('overdeck/ConversationWriter') {}

// ── Legacy-compatible sync door ──────────────────────────────────────────────
//
// These exports keep the current dashboard/CLI call sites synchronous while
// moving the storage boundary to overdeck.db. They must not call the legacy
// panopticon.db conversation helpers.

export type LegacyTitleSource = 'auto' | 'ai' | 'ai-refined' | 'ai-explicit' | 'manual' | 'default';

export interface ForkRequest {
  parentConversationName: string;
  sessionId: string;
  forkMode: 'summary' | 'plain' | 'handoff';
  issueId?: string;
  summaryModel?: string;
  localSummaryOnly: boolean;
  includeThinkingInSummary?: boolean;
  summaryHarness?: RuntimeName;
  handoffFocus?: string;
  handoffAuthor: 'source' | 'external';
  handoffAuthorModel?: string;
  handoffAuthorHarness?: RuntimeName;
  /** Operator-provided title (--title / fork modal). Authoritative: the
   * pipeline must re-apply it after authoring instead of the focus-derived
   * fallback (PAN-3774). */
  title?: string;
}

/** Gauntlet lane roles (PAN-4223 glossary). Stored verbatim in `conversations.lane_role`. */
export const LANE_ROLES = ['builder', 'critic', 'verifier', 'play', 'orchestrator'] as const;
export type LaneRole = (typeof LANE_ROLES)[number];

export interface LegacyConversation {
  id: number;
  name: string;
  tmuxSession: string;
  status: 'active' | 'ended';
  cwd: string;
  issueId: string | null;
  createdAt: string;
  endedAt: string | null;
  lastAttachedAt: string | null;
  claudeSessionId: string | null;
  title: string | null;
  titleSource: LegacyTitleSource | null;
  titleSeed: string | null;
  totalCost: number;
  totalTokens: number;
  archivedAt: string | null;
  model: string | null;
  effort: string | null;
  forkStatus: string | null;
  forkError: string | null;
  harness: RuntimeName | null;
  deliveryMethod: 'auto' | 'channels' | 'tmux' | null;
  spawnError: string | null;
  handoffDocPath: string | null;
  handoffTargetConvId: number | null;
  forkFallbackReason: string | null;
  clearedToConvId: number | null;
  forkRequest: string | null;
  forkRetryCount: number;
  workspaceId: string | null;
  /** Explicit project assignment override. Null = fall back to deriving the project from cwd. */
  projectKey: string | null;
  /** PAN-4185: launch without any Overdeck-injected context (launch bundle, briefing, memory hooks, resume contract). */
  bareContext: boolean;
  /** PAN-4185: Claude Code skips native CLAUDE.md and auto-memory loading (CLAUDE_CODE_DISABLE_CLAUDE_MDS). */
  skipClaudeMd: boolean;
  /** PAN-4223: legacy rowid of the launching conversation (lane door) or the
   * handoff/fork source (successor). Write-once launch-time fact; null = root. */
  parentConversationId: number | null;
  /** PAN-4223: the parent's name, joined at read time. */
  parentConversationName: string | null;
  /** PAN-4223: run key; a run is the set of rows sharing it. Null unless the row is a lane. */
  gauntletRun: string | null;
  /** PAN-4223: the lane's short name inside its run. Null = not a lane (root or successor). */
  laneKey: string | null;
  /** PAN-4223: the lane's role. Null unless the row is a lane. */
  laneRole: LaneRole | null;
  /** PAN-4223 D26: legacy rowid of the builder row a critic or verifier judges. */
  criticOfConversationId: number | null;
  criticOfConversationName: string | null;
}

export interface ArchivedConversationWithEnrichment {
  id: number;
  name: string;
  cwd: string;
  issueId: string | null;
  createdAt: string;
  claudeSessionId: string | null;
  harness: RuntimeName | null;
  title: string | null;
  totalCost: number;
  archivedAt: string;
  model: string | null;
  discoveredJsonlPath: string | null;
  discoveredWorkspacePath: string | null;
  messageCount: number | null;
  firstTs: string | null;
  lastTs: string | null;
  primaryModel: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  estimatedCost: number | null;
  toolsUsed: string | null;
  filesTouched: string | null;
  tags: string | null;
  summary: string | null;
  enrichmentLevel: number | null;
  enrichmentFailed: number | null;
}

export interface ArchivedConversationListOptions {
  harness?: RuntimeName;
  workspacePath?: string;
  primaryModel?: string;
  unmanaged?: boolean;
  since?: string;
  before?: string;
  after?: string;
  minCost?: number;
  maxCost?: number;
  minMessages?: number;
  issueId?: string;
  enriched?: boolean;
  notEnriched?: boolean;
  enrichmentLevel?: number;
  enrichmentLevelLessThan?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  limit?: number;
  offset?: number;
}

export type LegacyFavoriteType = 'conversation';

interface LegacyConversationRow {
  legacy_id: number;
  id: string;
  name: string;
  cwd: string;
  issue_id: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  title: string | null;
  title_source: string | null;
  created_at: number | Date;
  archived_at: number | Date | null;
  handoff_doc_path: string | null;
  handoff_target_conv_id: string | null;
  cleared_to_conv_id: string | null;
  claude_session_id: string | null;
  tmux_session: string | null;
  status: string | null;
  ended_at: number | null;
  last_attached_at: number | null;
  session_file: string | null;
  total_cost: number | null;
  total_tokens: number | null;
  fork_status: string | null;
  fork_error: string | null;
  fork_retry_count: number | null;
  fork_request: string | null;
  fork_fallback_reason: string | null;
  delivery_method: string | null;
  spawn_error: string | null;
  workspace_id: string | null;
  project_key: string | null;
  bare_context: number | null;
  skip_claude_md: number | null;
  parent_conversation_id: string | null;
  parent_legacy_id: number | null;
  parent_name: string | null;
  gauntlet_run: string | null;
  lane_key: string | null;
  lane_role: string | null;
  critic_of_legacy_id: number | null;
  critic_of_name: string | null;
}

const LEGACY_CONVERSATION_SELECT = `
  SELECT
    c.rowid AS legacy_id,
    c.id,
    c.name,
    c.cwd,
    c.issue_id,
    c.harness,
    c.model,
    c.effort,
    c.title,
    c.title_source,
    c.created_at,
    c.archived_at,
    c.handoff_doc_path,
    c.handoff_target_conv_id,
    c.cleared_to_conv_id,
    c.tmux_session,
    c.status,
    c.ended_at,
    c.last_attached_at,
    c.session_file,
    c.total_cost,
    c.total_tokens,
    c.fork_status,
    c.fork_error,
    c.fork_retry_count,
    c.fork_request,
    c.fork_fallback_reason,
    c.delivery_method,
    c.spawn_error,
    c.workspace_id,
    c.project_key,
    c.bare_context,
    c.skip_claude_md,
    c.parent_conversation_id,
    p.rowid AS parent_legacy_id,
    p.name AS parent_name,
    c.gauntlet_run,
    c.lane_key,
    c.lane_role,
    b.rowid AS critic_of_legacy_id,
    b.name AS critic_of_name,
    (
      SELECT cf.locator
      FROM conversation_files cf
      WHERE cf.conversation_id = c.id
      ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
      LIMIT 1
    ) AS claude_session_id
  FROM conversations c
  LEFT JOIN conversations p ON p.id = c.parent_conversation_id
  LEFT JOIN conversations b ON b.id = c.critic_of_conversation_id
`;

const AGENT_CONVERSATION_PREFIXES = ['agent-', 'planning-', 'specialist-'];

export function isAgentConversationName(name: string): boolean {
  return AGENT_CONVERSATION_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Live Claude session id for a conversation — consistent across every consumer (PAN-1866).
 *
 * Work-agent / specialist conversations rotate Claude sessions, but the DB only records the
 * FIRST session (the oldest conversation_files locator), so the stored id is stale by
 * construction. The agent folder's append-only session index is authoritative.
 * For agent conversations resolve its newest entry, falling back to the DB value;
 * for human conversation-panel sessions the DB value is canonical. Applied at the read door so the
 * CLI, panel, teardown, and frontend all observe the same id.
 *
 * Read inline (not via lib/agents.ts) to avoid the agents <-> conversations import cycle.
 */
function resolveLiveSessionId(conv: {
  name: string;
  tmuxSession: string;
  claudeSessionId: string | null;
}): string | null {
  if (!isAgentConversationName(conv.name)) return conv.claudeSessionId;
  return readLatestIndexedSessionId(conv.tmuxSession) ?? conv.claudeSessionId;
}

function overdeckDb() {
  return getOverdeckDatabase();
}

function toIso(value: number | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function toMillis(value: Date | string | number = new Date()): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** Map a raw DB harness string to a canonical RuntimeName, normalizing legacy 'pi' to 'ohmypi' on read. */
export function normalizeHarness(harness: string | null): RuntimeName | null {
  if (harness === 'pi' || harness === 'ohmypi') return 'ohmypi';
  if (harness === 'claude-code' || harness === 'codex' || harness === 'acp' || harness === 'kimi-code' || harness === 'opencode' || harness === 'muse') return harness;
  return null;
}

function legacyRowIdForConversationId(id: string | null): number | null {
  if (!id) return null;
  const row = overdeckDb()
    .prepare(`SELECT rowid AS id FROM conversations WHERE id = ?`)
    .get(id) as { id: number } | undefined;
  return row?.id ?? null;
}

function conversationUuidForLegacyId(id: number): string | null {
  const row = overdeckDb()
    .prepare(`SELECT id FROM conversations WHERE rowid = ?`)
    .get(id) as { id: string } | undefined;
  return row?.id ?? null;
}

function rowToLegacyConversation(row: LegacyConversationRow): LegacyConversation {
  const archivedAt = toIso(row.archived_at);
  return {
    id: row.legacy_id,
    name: row.name,
    tmuxSession: row.tmux_session ?? `conv-${row.name}`,
    status: (row.status ?? (archivedAt ? 'ended' : 'active')) as 'active' | 'ended',
    cwd: row.cwd,
    issueId: row.issue_id ?? null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    endedAt: toIso(row.ended_at) ?? archivedAt,
    lastAttachedAt: toIso(row.last_attached_at),
    claudeSessionId: resolveLiveSessionId({
      name: row.name,
      tmuxSession: row.tmux_session ?? `conv-${row.name}`,
      claudeSessionId: row.claude_session_id ?? null,
    }),
    title: row.title ?? null,
    titleSource: (row.title_source as LegacyTitleSource | null) ?? null,
    titleSeed: row.title ?? null,
    totalCost: row.total_cost ?? 0,
    totalTokens: row.total_tokens ?? 0,
    archivedAt,
    model: row.model ?? null,
    effort: row.effort ?? null,
    forkStatus: row.fork_status ?? null,
    forkError: row.fork_error ?? null,
    harness: normalizeHarness(row.harness),
    deliveryMethod: (row.delivery_method as 'auto' | 'channels' | 'tmux' | null) ?? null,
    spawnError: row.spawn_error ?? null,
    handoffDocPath: row.handoff_doc_path ?? null,
    handoffTargetConvId: legacyRowIdForConversationId(row.handoff_target_conv_id),
    forkFallbackReason: row.fork_fallback_reason ?? null,
    clearedToConvId: legacyRowIdForConversationId(row.cleared_to_conv_id),
    forkRequest: row.fork_request ?? null,
    forkRetryCount: row.fork_retry_count ?? 0,
    workspaceId: row.workspace_id ?? null,
    projectKey: row.project_key ?? null,
    bareContext: row.bare_context === 1,
    skipClaudeMd: row.skip_claude_md === 1,
    parentConversationId: row.parent_legacy_id ?? null,
    parentConversationName: row.parent_name ?? null,
    gauntletRun: row.gauntlet_run ?? null,
    laneKey: row.lane_key ?? null,
    laneRole: (row.lane_role as LaneRole | null) ?? null,
    criticOfConversationId: row.critic_of_legacy_id ?? null,
    criticOfConversationName: row.critic_of_name ?? null,
  };
}

function getConversationByUuid(id: string): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.id = ?`)
    .get(id) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

function getConversationUuidByName(name: string): string | null {
  const row = overdeckDb()
    .prepare(`SELECT id FROM conversations WHERE name = ?`)
    .get(name) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Aggregate each conversation's cost + token usage from the canonical `cost_events`
 * ledger, keyed by session id and joined through `conversation_files`. This is the
 * source of truth for conversation cost: `conversations.total_cost` is only a
 * denormalized cache written when a conversation is opened (via the /messages
 * route), so it reads stale/zero for any conversation not opened since the
 * overdeck.db cutover. The list reads from this ledger so it shows live costs
 * without requiring each conversation to be opened first.
 *
 * Returns a map of conversation id → { cost, tokens }. A conversation predating the
 * ledger has no rows and is simply absent — callers fall back to the cached
 * `total_cost` column for those.
 */
export function getConversationLedgerCosts(): Map<string, { cost: number; tokens: number }> {
  // Keyed by the conversation's rowid, because that is the public `id`
  // {@link LegacyConversation.id} carries (c.rowid AS legacy_id), not the uuid.
  // cost_events.session_id matches conversation_files.locator; a conversation may
  // have several locators (relaunch/clear), so we sum across all of them.
  const rows = overdeckDb()
    .prepare(
      `SELECT c.rowid AS cid,
              COALESCE(SUM(ce.cost), 0) AS cost,
              COALESCE(SUM(ce.input + ce.output + ce.cache_read + ce.cache_write), 0) AS tokens
       FROM cost_events ce
       JOIN conversation_files cf ON cf.locator = ce.session_id
       JOIN conversations c ON c.id = cf.conversation_id
       GROUP BY c.rowid`,
    )
    .all() as { cid: number; cost: number; tokens: number }[];
  const map = new Map<string, { cost: number; tokens: number }>();
  for (const r of rows) map.set(String(r.cid), { cost: r.cost ?? 0, tokens: r.tokens ?? 0 });
  return map;
}

export function listConversations(options?: { limit?: number; offset?: number }): LegacyConversation[] {
  let sql = `${LEGACY_CONVERSATION_SELECT}
    WHERE c.archived_at IS NULL
      AND c.name NOT LIKE 'agent-%'
      AND c.name NOT LIKE 'planning-%'
      AND c.name NOT LIKE 'specialist-%'
    ORDER BY c.created_at DESC`;
  const params: number[] = [];
  if (options?.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset !== undefined) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }
  const rows = overdeckDb().prepare(sql).all(...params) as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

export function getConversationByName(name: string): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.name = ?`)
    .get(name) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function getConversationById(id: number): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.rowid = ?`)
    .get(id) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function getConversationByClaudeSessionId(claudeSessionId: string): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE EXISTS (
        SELECT 1 FROM conversation_files cf
        WHERE cf.conversation_id = c.id AND cf.locator = ?
      )`)
    .get(claudeSessionId) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}
export { findConversationForCostSession } from './conversation-cost-session.js';
export function getConversationByTmuxSession(tmuxSession: string): LegacyConversation | null {
  const name = tmuxSession.startsWith('conv-') ? tmuxSession.slice(5) : tmuxSession;
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE c.name = ? AND c.archived_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 1`)
    .get(name) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

/** A tmux session's own row: a post-/clear sibling over its cleared parent (PAN-3962). */
export function getSupervisedConversationByTmuxSession(tmuxSession: string): LegacyConversation | null {
  const name = tmuxSession.startsWith('conv-') ? tmuxSession.slice(5) : tmuxSession;
  const row = overdeckDb().prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE c.archived_at IS NULL AND (c.tmux_session = ? OR (c.tmux_session IS NULL AND c.name = ?))
      ORDER BY (c.cleared_to_conv_id IS NULL) DESC, (c.status = 'active') DESC, c.created_at DESC, c.rowid DESC
      LIMIT 1`).get(tmuxSession, name) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function listArchivedConversations(): LegacyConversation[] {
  const rows = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE c.archived_at IS NOT NULL
      ORDER BY c.archived_at DESC, c.created_at DESC`)
    .all() as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

/**
 * PAN-4223: lane rows (lane_key set), archived or not, oldest first. A run's
 * ledger stays complete after reap archives its lanes (D14), and successors of
 * a lane are never lanes themselves (D21), so they never appear here.
 */
export function listLaneConversations(filter: {
  run?: string;
  parentName?: string;
  key?: string;
  role?: LaneRole;
}): LegacyConversation[] {
  const conditions = ['c.lane_key IS NOT NULL'];
  const params: string[] = [];
  if (filter.run !== undefined) { conditions.push('c.gauntlet_run = ?'); params.push(filter.run); }
  if (filter.parentName !== undefined) { conditions.push('p.name = ?'); params.push(filter.parentName); }
  if (filter.key !== undefined) { conditions.push('c.lane_key = ?'); params.push(filter.key); }
  if (filter.role !== undefined) { conditions.push('c.lane_role = ?'); params.push(filter.role); }
  const rows = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at ASC, c.rowid ASC`)
    .all(...params) as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

/**
 * PAN-4223 D21: the row whose standing the lane door judges. Follows parent
 * links while the current row is a successor (no lane_key, parent set) and
 * stops at a lane, at a root, or at an already-visited id. Null for an
 * unknown name.
 */
export function resolveEffectiveLauncher(name: string): LegacyConversation | null {
  let current = getConversationByName(name);
  if (!current) return null;
  const visited = new Set<number>([current.id]);
  while (current.laneKey === null && current.parentConversationId !== null) {
    if (visited.has(current.parentConversationId)) break;
    const parent = getConversationById(current.parentConversationId);
    if (!parent) break;
    visited.add(parent.id);
    current = parent;
  }
  return current;
}

export function listArchivedConversationsWithEnrichment(options: ArchivedConversationListOptions = {}): ArchivedConversationWithEnrichment[] {
  ensureDiscoveredSessionsSchema();
  const db = overdeckDb();

  const conditions: string[] = ['c.archived_at IS NOT NULL'];
  const params: unknown[] = [];

  const lastTs = `COALESCE(ds.last_ts, c.archived_at)`;
  const firstTs = `COALESCE(ds.first_ts, c.created_at)`;
  const primaryModel = `COALESCE(ds.primary_model, c.model)`;
  const estimatedCost = `COALESCE(ds.estimated_cost, c.total_cost)`;
  const messageCount = `COALESCE(ds.message_count, 0)`;
  const enrichmentLevel = `COALESCE(ds.enrichment_level, 0)`;

  if (options.harness === 'claude-code') {
    conditions.push('(c.harness = ? OR c.harness IS NULL)');
    params.push(options.harness);
  } else if (options.harness === 'ohmypi') {
    conditions.push('(c.harness = ? OR c.harness = ?)');
    params.push(options.harness, 'pi');
  } else if (options.harness !== undefined) {
    conditions.push('c.harness = ?');
    params.push(options.harness);
  }
  if (options.workspacePath !== undefined) { conditions.push('c.cwd = ?'); params.push(options.workspacePath); }
  if (options.primaryModel !== undefined) { conditions.push(`${primaryModel} = ?`); params.push(options.primaryModel); }
  if (options.issueId !== undefined) { conditions.push('c.issue_id = ?'); params.push(options.issueId); }
  if (options.since !== undefined) { conditions.push(`${lastTs} >= ?`); params.push(toMillis(options.since)); }
  if (options.before !== undefined) { conditions.push(`${lastTs} < ?`); params.push(toMillis(options.before)); }
  if (options.after !== undefined) { conditions.push(`${firstTs} >= ?`); params.push(toMillis(options.after)); }
  if (options.minCost !== undefined) { conditions.push(`${estimatedCost} >= ?`); params.push(options.minCost); }
  if (options.maxCost !== undefined) { conditions.push(`${estimatedCost} <= ?`); params.push(options.maxCost); }
  if (options.minMessages !== undefined) { conditions.push(`${messageCount} >= ?`); params.push(options.minMessages); }
  if (options.unmanaged === true) { conditions.push('0 = 1'); }
  if (options.enriched === true) { conditions.push(`${enrichmentLevel} > 0`); }
  if (options.notEnriched === true) { conditions.push(`${enrichmentLevel} = 0`); }
  if (options.enrichmentLevel !== undefined) { conditions.push(`${enrichmentLevel} = ?`); params.push(options.enrichmentLevel); }
  if (options.enrichmentLevelLessThan !== undefined) { conditions.push(`${enrichmentLevel} < ?`); params.push(options.enrichmentLevelLessThan); }
  if (options.tags?.length) {
    for (const tag of options.tags) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_tags dst WHERE dst.session_id = ds.id AND dst.tag = ?)`);
      params.push(tag);
    }
  }
  if (options.tools?.length) {
    for (const tool of options.tools) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_tools dstool WHERE dstool.session_id = ds.id AND dstool.tool = ?)`);
      params.push(tool);
    }
  }
  if (options.files?.length) {
    for (const file of options.files) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_files dsfile WHERE dsfile.session_id = ds.id AND dsfile.file_path = ?)`);
      params.push(file);
    }
  }

  const safeLimit = Number.isFinite(options.limit) && options.limit! >= 0 ? options.limit! : undefined;
  const safeOffset = Number.isFinite(options.offset) && options.offset! >= 0 ? options.offset! : undefined;
  const limitClause = safeLimit !== undefined ? 'LIMIT ?' : safeOffset !== undefined ? 'LIMIT -1' : '';
  const offsetClause = safeOffset !== undefined ? 'OFFSET ?' : '';
  if (safeLimit !== undefined) params.push(safeLimit);
  if (safeOffset !== undefined) params.push(safeOffset);

  const where = `WHERE ${conditions.join(' AND ')}`;
  const sql = `
    SELECT
      c.rowid AS legacy_id,
      c.id AS uuid,
      c.name,
      c.cwd,
      c.issue_id,
      c.created_at,
      c.harness,
      (
        SELECT cf.locator FROM conversation_files cf
        WHERE cf.conversation_id = c.id
        ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
        LIMIT 1
      ) AS claude_session_id,
      c.title,
      c.total_cost,
      c.archived_at,
      c.model,
      ds.jsonl_path AS discovered_jsonl_path,
      ds.workspace_path AS discovered_workspace_path,
      ds.message_count,
      ds.first_ts,
      ds.last_ts,
      ds.primary_model,
      ds.token_input,
      ds.token_output,
      ds.estimated_cost,
      ds.tools_used,
      ds.files_touched,
      ds.tags,
      ds.summary,
      ds.enrichment_level,
      ds.enrichment_failed
    FROM conversations c
    LEFT JOIN discovered_sessions ds ON ds.session_id = (
      SELECT cf.locator FROM conversation_files cf
      WHERE cf.conversation_id = c.id
      ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
      LIMIT 1
    )
    ${where}
    ORDER BY c.archived_at DESC, c.created_at DESC
    ${limitClause} ${offsetClause}
  `;

  type RawRow = {
    legacy_id: number; uuid: string; name: string; cwd: string; issue_id: string | null;
    created_at: number; harness: string | null; claude_session_id: string | null; title: string | null;
    total_cost: number | null; archived_at: number | null; model: string | null;
    discovered_jsonl_path: string | null; discovered_workspace_path: string | null;
    message_count: number | null; first_ts: number | null; last_ts: number | null;
    primary_model: string | null; token_input: number | null; token_output: number | null;
    estimated_cost: number | null; tools_used: string | null; files_touched: string | null;
    tags: string | null; summary: string | null; enrichment_level: number | null;
    enrichment_failed: number | null;
  };

  const rawRows = db.prepare(sql).all(...params) as RawRow[];

  return rawRows.map((r): ArchivedConversationWithEnrichment => ({
    id: r.legacy_id,
    name: r.name,
    cwd: r.cwd,
    issueId: r.issue_id ?? null,
    createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
    claudeSessionId: r.claude_session_id ?? null,
    harness: normalizeHarness(r.harness),
    title: r.title ?? null,
    totalCost: r.total_cost ?? 0,
    archivedAt: toIso(r.archived_at) ?? toIso(r.created_at) ?? new Date(0).toISOString(),
    model: r.model ?? null,
    discoveredJsonlPath: r.discovered_jsonl_path ?? null,
    discoveredWorkspacePath: r.discovered_workspace_path ?? r.cwd,
    messageCount: r.message_count ?? null,
    firstTs: toIso(r.first_ts),
    lastTs: toIso(r.last_ts),
    primaryModel: r.primary_model ?? r.model ?? null,
    tokenInput: r.token_input ?? null,
    tokenOutput: r.token_output ?? null,
    estimatedCost: r.estimated_cost ?? null,
    toolsUsed: r.tools_used ?? null,
    filesTouched: r.files_touched ?? null,
    tags: r.tags ?? null,
    summary: r.summary ?? null,
    enrichmentLevel: r.enrichment_level ?? null,
    enrichmentFailed: r.enrichment_failed ?? null,
  }));
}

const nullIfEmpty = (value: string | undefined): string | null => value?.trim() || null;
export function createConversation(opts: {
  name: string;
  tmuxSession: string;
  cwd: string;
  issueId?: string;
  claudeSessionId?: string;
  title?: string;
  titleSource?: LegacyTitleSource;
  titleSeed?: string;
  model?: string;
  effort?: string;
  forkStatus?: string;
  harness?: RuntimeName;
  deliveryMethod?: 'auto' | 'channels' | 'tmux';
  /** PAN-1990: explicit workspace id. Falls back to resolveWorkspaceForCwd(cwd) when omitted. */
  workspaceId?: string | null;
  /** Explicit registered-project association; never inferred from cwd at write time. */
  projectKey?: string | null;
  /** PAN-4185: see LegacyConversation.bareContext. */
  bareContext?: boolean;
  /** PAN-4185: see LegacyConversation.skipClaudeMd. */
  skipClaudeMd?: boolean;
  /** PAN-4223: name of the launching (lane) or source (successor) conversation. Must exist. */
  parentName?: string;
  /** PAN-4223: lane facts; requires parentName. Omitted = a root or a successor. */
  lane?: { run: string; key: string; role: LaneRole; criticOfName?: string };
}): LegacyConversation {
  const db = overdeckDb();
  const id = randomUUID();
  const now = toMillis();
  const workspaceId = opts.workspaceId !== undefined
    ? opts.workspaceId
    : (resolveWorkspaceForCwd(opts.cwd)?.id ?? null);
  // Validate the parent link before the transaction so a bad parent inserts
  // nothing (and never deletes a same-name row).
  if (opts.lane && !opts.parentName) throw new Error('a lane needs a parent');
  let parentId: string | null = null;
  if (opts.parentName) {
    parentId = getConversationUuidByName(opts.parentName);
    if (!parentId) throw new Error(`parent conversation ${opts.parentName} not found`);
  }
  let criticOfId: string | null = null;
  if (opts.lane?.criticOfName) {
    if (opts.lane.role !== 'critic' && opts.lane.role !== 'verifier') throw new Error('only critic and verifier lanes link a builder');
    criticOfId = getConversationUuidByName(opts.lane.criticOfName);
    if (!criticOfId) throw new Error(`critic target ${opts.lane.criticOfName} not found`);
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM conversation_files WHERE conversation_id IN (SELECT id FROM conversations WHERE name = ?)`).run(opts.name);
    db.prepare(`DELETE FROM conversations WHERE name = ?`).run(opts.name);
    db.prepare(`
      INSERT INTO conversations
        (id, name, cwd, issue_id, harness, model, effort, title, title_source, created_at, archived_at,
         tmux_session, status, fork_status, fork_retry_count, delivery_method, spawn_error, workspace_id, project_key,
         bare_context, skip_claude_md, parent_conversation_id, gauntlet_run, lane_key, lane_role, critic_of_conversation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      opts.name,
      opts.cwd,
      opts.issueId ?? null,
      opts.harness ?? null,
      nullIfEmpty(opts.model),
      nullIfEmpty(opts.effort),
      opts.title ?? null,
      opts.titleSource ?? (opts.title ? 'auto' : null),
      now,
      opts.tmuxSession ?? null,
      opts.forkStatus ?? null,
      opts.deliveryMethod ?? null,
      null,  // spawn_error starts null
      workspaceId,
      opts.projectKey ?? null,
      opts.bareContext ? 1 : 0,
      opts.skipClaudeMd ? 1 : 0,
      parentId,
      opts.lane?.run ?? null,
      opts.lane?.key ?? null,
      opts.lane?.role ?? null,
      criticOfId,
    );
    if (opts.claudeSessionId) {
      db.prepare(`
        INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, opts.harness ?? 'claude-code', opts.claudeSessionId, now);
    }
  })();

  const conv = getConversationByUuid(id);
  if (!conv) throw new Error(`Failed to create conversation ${opts.name}`);
  return conv;
}

export function markConversationEnded(name: string, endedAtMs: number = Date.now()): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET ended_at = ?, status = 'ended' WHERE name = ?`)
    .run(endedAtMs, name);
}

// PAN-1972/PAN-3671: resurrect a conversation when tmux + the harness are alive,
// clearing stale spawn failures and failed fork state. Preserve in-flight fork
// state for stuck-fork recovery. Active rows remain a true no-op.
export function markConversationRunning(name: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET status = 'active', ended_at = NULL, spawn_error = NULL,
      fork_error = CASE WHEN fork_status = 'failed' THEN NULL ELSE fork_error END,
      fork_status = CASE WHEN fork_status = 'failed' THEN NULL ELSE fork_status END WHERE name = ? AND status != 'active'`)
    .run(name);
}

// Called once a conversation is confirmed running (resume, reattach, restart,
// fork ready, hook activity). A running harness disproves any earlier spawn
// error, whatever the row's status: markConversationRunning skips active rows,
// so an active row's spawn_error would otherwise never clear (review of #4137).
export function markConversationActive(name: string): void {
  overdeckDb().prepare(`UPDATE conversations SET archived_at = NULL, spawn_error = NULL WHERE name = ?`).run(name);
}

export function reactivateConversationForSpawn(opts: {
  name: string;
  tmuxSession: string;
  cwd: string;
  issueId?: string;
  claudeSessionId?: string;
  model?: string;
  harness?: RuntimeName;
}): void {
  const db = overdeckDb();
  const now = toMillis();
  const id = getConversationUuidByName(opts.name);
  if (!id) return;
  db.prepare(`
    UPDATE conversations
    SET cwd = ?, issue_id = ?, model = ?, harness = ?, archived_at = NULL
    WHERE id = ?
  `).run(opts.cwd, opts.issueId ?? null, nullIfEmpty(opts.model), opts.harness ?? null, id);
  if (opts.claudeSessionId) {
    db.prepare(`
      INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, opts.harness ?? 'claude-code', opts.claudeSessionId, now);
  }
}

export function updateLastAttached(name: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET last_attached_at = ? WHERE name = ?`)
    .run(Date.now(), name);
}

export function updateConversationTitle(name: string, title: string, titleSource?: LegacyTitleSource): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET title = ?, title_source = COALESCE(?, title_source) WHERE name = ?`)
    .run(title, titleSource ?? null, name);
  try {
    getEventStore().emitOnly({
      type: 'conversation.title_changed',
      timestamp: new Date().toISOString(),
      payload: { conversationName: name, title, titleSource: titleSource ?? '' },
    });
  } catch {
    // Event store is uninitialized in CLI/test contexts; title persistence is enough.
  }
}

export function archiveConversation(name: string): void {
  const db = overdeckDb();
  db.prepare(`UPDATE conversations SET archived_at = ? WHERE name = ?`).run(toMillis(), name);
  db.prepare(`DELETE FROM favorites WHERE type = 'conversation' AND item_id = ?`).run(name);
}

export function unarchiveConversation(name: string): void {
  overdeckDb().prepare(`UPDATE conversations SET archived_at = NULL, spawn_error = NULL WHERE name = ?`).run(name);
}

export function updateConversationCost(name: string, totalCost: number, totalTokens?: number): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET total_cost = ?, total_tokens = COALESCE(?, total_tokens) WHERE name = ?`)
    .run(totalCost, totalTokens ?? null, name);
}

export function setConversationModel(name: string, model: string): void {
  overdeckDb().prepare(`UPDATE conversations SET model = ? WHERE name = ?`).run(model, name);
}

export function setConversationEffort(name: string, effort: string | null): void {
  overdeckDb().prepare(`UPDATE conversations SET effort = ? WHERE name = ?`).run(effort, name);
}

export function setConversationHarness(name: string, harness: RuntimeName): void {
  overdeckDb().prepare(`UPDATE conversations SET harness = ? WHERE name = ?`).run(harness, name);
}

/** Set (or clear, with null) the project assignment override for a conversation. */
export function setConversationProjectKey(name: string, projectKey: string | null): void {
  overdeckDb().prepare(`UPDATE conversations SET project_key = ? WHERE name = ?`).run(projectKey, name);
}

export function setConversationClaudeSessionId(name: string, claudeSessionId: string): void {
  const db = overdeckDb();
  const id = getConversationUuidByName(name);
  if (!id) return;
  const harness = getConversationByName(name)?.harness ?? 'claude-code';
  db.prepare(`
    INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, harness, claudeSessionId, toMillis());
}

export function updateConversationDeliveryMethod(name: string, method: 'auto' | 'channels' | 'tmux' | null): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET delivery_method = ? WHERE name = ?`)
    .run(method, name);
}
// Repair missing or empty model metadata without overwriting known models.
export function backfillConversationModel(name: string, model: string): void {
  overdeckDb().prepare(`UPDATE conversations SET model = ? WHERE name = ? AND (model IS NULL OR model = '')`).run(model, name);
}

export function updateForkStatus(name: string, status: string | null, error?: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_status = ?, fork_error = ? WHERE name = ?`)
    .run(status, error ?? null, name);
}

export function clearConversationFailureState(name: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_status = NULL, fork_error = NULL, spawn_error = NULL WHERE name = ?`)
    .run(name);
}

export function getStuckForks(): LegacyConversation[] {
  const rows = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.fork_status IS NOT NULL AND c.fork_status != 'failed' ORDER BY c.created_at ASC`)
    .all() as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

export function setForkRequest(name: string, json: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_request = ? WHERE name = ?`)
    .run(json, name);
}

export function incrementForkRetryCount(name: string): number {
  const db = overdeckDb();
  db.prepare(`UPDATE conversations SET fork_retry_count = fork_retry_count + 1 WHERE name = ?`).run(name);
  const row = db.prepare(`SELECT fork_retry_count FROM conversations WHERE name = ?`).get(name) as
    | { fork_retry_count: number }
    | undefined;
  return row?.fork_retry_count ?? 0;
}

export function updateConversationForkFallbackReason(name: string, reason: string | null): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_fallback_reason = ? WHERE name = ?`)
    .run(reason, name);
}

export function recordConversationHandoff(sourceName: string, targetName: string, docPath: string): LegacyConversation {
  const targetId = getConversationUuidByName(targetName);
  const target = targetId ? getConversationByUuid(targetId) : null;
  if (!targetId || !target) throw new Error(`Handoff target conversation ${targetName} not found`);
  const db = overdeckDb();
  db.prepare(`UPDATE conversations SET handoff_doc_path = ? WHERE id = ?`).run(docPath, targetId);
  db.prepare(`UPDATE conversations SET handoff_target_conv_id = ? WHERE name = ?`).run(targetId, sourceName);
  return getConversationByUuid(targetId) ?? target;
}

export function setClearedToConvId(name: string, convId: number): void {
  const targetUuid = conversationUuidForLegacyId(convId);
  overdeckDb().prepare(`UPDATE conversations SET cleared_to_conv_id = ? WHERE name = ?`).run(targetUuid, name);
}

export function hasOtherActiveConversationOnTmuxSession(_tmuxSession: string, _excludeName: string): boolean {
  return false;
}

export function updateSpawnError(name: string, error: string | null): void {
  overdeckDb().prepare(`UPDATE conversations SET spawn_error = ? WHERE name = ?`).run(error, name);
}

export function canReplaceTitle(conv: LegacyConversation): boolean {
  if (conv.titleSource === 'manual') return false;
  return conv.titleSource === 'default' || conv.titleSource === 'auto';
}

export function canRefineTitle(conv: LegacyConversation): boolean {
  return conv.titleSource === 'default'
    || conv.titleSource === 'auto'
    || conv.titleSource === 'ai'
    || conv.titleSource === 'ai-refined';
}

export function listFavoritedIds(type: LegacyFavoriteType): string[] {
  const rows = overdeckDb()
    .prepare(`SELECT item_id FROM favorites WHERE type = ?`)
    .all(type) as Array<{ item_id: string }>;
  return rows.map((row) => row.item_id);
}

export function setFavorite(type: LegacyFavoriteType, itemId: string): void {
  overdeckDb()
    .prepare(`INSERT OR IGNORE INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)`)
    .run(type, itemId, toMillis());
}

export function removeFavorite(type: LegacyFavoriteType, itemId: string): void {
  overdeckDb().prepare(`DELETE FROM favorites WHERE type = ? AND item_id = ?`).run(type, itemId);
}

export interface ImportLegacyConversationMapped {
  name: string;
  tmuxSession: string | null;
  status: 'active' | 'ended';
  cwd: string;
  createdAt: number;
  endedAt: number | null;
  lastAttachedAt: number | null;
  sessionFile: string | null;
  claudeSessionId: string | null;
  title: string | null;
  titleSource: string | null;
  titleSeed: string | null;
  totalCost: number;
  totalTokens: number;
  archivedAt: number | null;
  model: string | null;
  effort: string | null;
  forkStatus: string | null;
  forkError: string | null;
  harness: string | null;
  deliveryMethod: string | null;
  spawnError: string | null;
  handoffDocPath: string | null;
  forkFallbackReason: string | null;
  forkRequest: string | null;
  forkRetryCount: number;
}
