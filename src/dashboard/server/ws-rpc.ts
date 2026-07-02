/**
 * WebSocket RPC handlers — implements PanRpcGroup using Effect (PAN-428 B5)
 *
 * Connects the PanRpcGroup contract to the server-side service layer.
 * Terminal RPC methods (subscribeTerminal, terminalOpen/Write/Resize/Close)
 * are implemented via TerminalService (dual-runtime PTY, B20).
 */

import { Effect, Layer, Queue, Schedule, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { PanRpcGroup, PanRpcError, WS_METHODS } from '@overdeck/contracts';
import { PanOpen } from './services/open.js';
import { EventStoreService } from './services/domain-services.js';
import { ReadModelService, type ReadModelServiceShape } from './read-model.js';
import { TerminalService } from './services/terminal-service.js';
import { getConversationByName } from '../../lib/overdeck/conversations.js';
import { contextUsageFromParseResult, gateSnapshotEmission, parseConversationMessages, parseEntireConversation, watchConversation, type ParseState, type ParseResult } from './services/conversation-service.js';
import { isPiSessionFile, parsePiConversationMessages } from './services/pi-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from './services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from './services/codex-conversation-parser.js';
import { resolveAgentHarness, resolvePiSessionPath, resolveCodexRolloutPath, readLauncherPinnedSessionId } from './routes/jsonl-resolver.js';
import { watch as fsWatch } from 'node:fs';
import { sessionFilePath } from '../../lib/paths.js';
import { listSessionNames } from '../../lib/tmux.js';
import { listProjectsSync } from '../../lib/projects.js';
import type { AgentStatus, ConversationEvent, DomainEvent, EmbedProgressEvent, EnrichCompleteEvent, EnrichProgressEvent, ScanCompleteEvent, ScanProgressEvent, ScanStartedEvent, SessionNodePresence, SessionTreeDelta, SystemHeartbeatEvent } from '@overdeck/contracts';
import type { StoredEvent } from './event-store.js';
import { parseRelativeTime } from '../../lib/conversations/search.js';
import type { SearchResult } from '../../lib/conversations/search.js';
import { CostThresholdError } from '../../lib/conversations/enrichment/index.js';
import { getConversationsConfig } from '../../lib/config-yaml.js';
import type { RuntimeConversationsConfig } from '../../lib/config-yaml.js';
import type { ConversationFilter, DiscoveredSession } from '../../lib/overdeck/discovered-sessions.js';
import { validateOrigin } from './routes/origin-validation.js';
import { jsonResponse } from './http-helpers.js';
import { runDashboardDbJob } from './services/dashboard-db-task.js';
import { readCurrentLatestFlywheelStatus, subscribeLatestFlywheelStatus } from './services/flywheel-run-state.js';
import { readWorkspaceFileEffect } from './services/read-workspace-file.js';
import { resolveFilePathExistsEffect } from './services/resolve-file-path-exists.js';
import { getHarnessBehavior } from '../../lib/runtimes/behavior.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function storedToDomainEvent(stored: StoredEvent): DomainEvent {
  return {
    type: stored.type,
    sequence: stored.sequence,
    timestamp: stored.timestamp,
    payload: stored.payload,
  } as DomainEvent;
}

function createSystemHeartbeatEvent(): SystemHeartbeatEvent {
  const ts = Date.now();
  return {
    type: 'system.heartbeat',
    timestamp: new Date(ts).toISOString(),
    payload: { ts },
  };
}

function normalizedIssueId(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

type AgentIssueLookup = ReadonlyMap<string, string>;

type AgentIssueRecord = {
  id?: unknown;
  issueId?: unknown;
};

export function conversationDiscoveringStream(): Stream.Stream<ConversationEvent> {
  return Stream.succeed({ kind: 'discovering' } as ConversationEvent).pipe(
    Stream.repeat(Schedule.fixed('2 seconds')),
  );
}

/**
 * Live message stream for transcripts that only support a FULL parse (pi, codex)
 * — PAN-1908. Unlike the Claude incremental watcher, pi/codex parsers re-read the
 * whole file, so we emit a full `snapshot: true` event on first subscribe and on
 * every file change (debounced). The client reducer adopts snapshots
 * idempotently and never shrinks a populated view, so re-emitting the full
 * transcript on each append is safe and dedupes by message id.
 *
 * Used for synthetic agent sessions (work/planning/specialist panels) whose pi
 * or codex transcript the operator watches live. fs.watch fires on each append
 * pi/codex makes; a 300ms debounce coalesces bursts during active generation.
 */
function streamFullParseSnapshots(
  sessionFile: string,
  parse: (file: string) => Promise<ParseResult>,
  model: string | null,
): Stream.Stream<ConversationEvent, PanRpcError> {
  return Stream.callback<ConversationEvent, PanRpcError>((queue) =>
    Effect.acquireRelease(
      Effect.promise(async () => {
        let parsing = false;
        let pendingReparse = false;
        const emit = async (): Promise<void> => {
          if (parsing) { pendingReparse = true; return; }
          parsing = true;
          try {
            const result = await parse(sessionFile);
            try {
              Queue.offerUnsafe(queue, {
                kind: 'messages' as const,
                messages: result.messages,
                workLog: result.workLog,
                streaming: result.streaming,
                snapshot: true,
                proposedPlan: result.proposedPlan,
                compactBoundaries:
                  result.compactBoundaries && result.compactBoundaries.length > 0
                    ? result.compactBoundaries
                    : undefined,
                contextUsage: contextUsageFromParseResult(result, model),
              });
            } catch {
              // Queue shut down (client disconnected) — ignore.
            }
          } catch {
            // Transient parse failure (read during a write) — the next change
            // event re-parses cleanly.
          } finally {
            parsing = false;
            if (pendingReparse) { pendingReparse = false; void emit(); }
          }
        };

        await emit(); // authoritative initial snapshot

        let debounce: ReturnType<typeof setTimeout> | null = null;
        let watcher: ReturnType<typeof fsWatch> | null = null;
        try {
          watcher = fsWatch(sessionFile, () => {
            if (debounce) return;
            debounce = setTimeout(() => { debounce = null; void emit(); }, 300);
          });
        } catch {
          // If the watcher can't attach, the initial snapshot still rendered;
          // the client's HTTP path is its own fallback on reconnect.
        }
        return {
          stop: () => {
            if (debounce) { clearTimeout(debounce); debounce = null; }
            if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
          },
        };
      }),
      (handle) => Effect.sync(() => handle.stop()),
    ),
  );
}

export function streamResolvedFullParseSnapshots(
  resolve: () => Promise<string | null>,
  parse: (file: string) => Promise<ParseResult>,
  model: string | null,
  // When true, "no transcript file resolved yet" is treated as an EMPTY (ready)
  // conversation rather than a still-discovering one. Interactive pi/codex
  // conversations write no transcript until their first turn, so a brand-new
  // one that is alive and simply waiting for the user's first message would
  // otherwise sit on "Discovering conversation…" forever. resolve() returns
  // null ONLY when no transcript exists on disk (a resumed conversation already
  // has its file), so emitting an empty snapshot here never blanks real history.
  unresolvedMeansEmpty = false,
): Stream.Stream<ConversationEvent, PanRpcError> {
  return Stream.callback<ConversationEvent, PanRpcError>((queue) =>
    Effect.acquireRelease(
      Effect.promise(async () => {
        let stopped = false;
        let resolving = false;
        let discoveryTimer: ReturnType<typeof setInterval> | null = null;
        let debounce: ReturnType<typeof setTimeout> | null = null;
        let watcher: ReturnType<typeof fsWatch> | null = null;
        let parsing = false;
        let pendingReparse = false;
        let sessionFile: string | null = null;
        // Whether we've already emitted the empty/ready snapshot for an
        // unresolved interactive conversation, so the 2s discovery poll doesn't
        // re-offer it on every tick.
        let announcedEmpty = false;
        // Lock onto a transcript only once we've actually parsed content from it.
        // A brand-new pi/codex conversation can briefly resolve to an empty
        // placeholder transcript while the real session is written under a
        // different (session-id) filename. The old code stopped discovery at the
        // FIRST resolved file and tailed that empty file forever — so the panel
        // showed the empty "How can I help you?" state until a manual refresh
        // re-subscribed. We keep re-resolving (and switch to the newest file)
        // until content appears, which also covers a watcher that misses appends.
        let hasContent = false;

        const stopDiscovery = () => {
          if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
        };

        const offer = (event: ConversationEvent) => {
          try {
            Queue.offerUnsafe(queue, event);
          } catch {
            // Queue shut down (client disconnected) — ignore.
          }
        };

        const emit = async (): Promise<void> => {
          if (!sessionFile || stopped) return;
          if (parsing) { pendingReparse = true; return; }
          parsing = true;
          try {
            const result = await parse(sessionFile);
            if (result.messages.length > 0 && !hasContent) {
              // Real content arrived — lock onto this file and stop polling.
              hasContent = true;
              stopDiscovery();
            }
            offer({
              kind: 'messages' as const,
              messages: result.messages,
              workLog: result.workLog,
              streaming: result.streaming,
              snapshot: true,
              proposedPlan: result.proposedPlan,
              compactBoundaries:
                result.compactBoundaries && result.compactBoundaries.length > 0
                  ? result.compactBoundaries
                  : undefined,
              contextUsage: contextUsageFromParseResult(result, model),
            });
          } catch {
            // Transient parse failure (read during a write) — the next change
            // event re-parses cleanly.
          } finally {
            parsing = false;
            if (pendingReparse) { pendingReparse = false; void emit(); }
          }
        };

        const watchFile = (file: string) => {
          try {
            watcher = fsWatch(file, () => {
              if (debounce) return;
              debounce = setTimeout(() => { debounce = null; void emit(); }, 300);
            });
          } catch {
            // If the watcher can't attach, the discovery poll still re-parses.
          }
        };

        const tryResolve = async (): Promise<void> => {
          if (stopped || resolving || hasContent) return;
          resolving = true;
          try {
            const resolved = await resolve();
            if (!resolved) {
              // No transcript on disk yet. For an interactive conversation that
              // means it is brand-new and waiting for its first turn — show the
              // ready (empty) state like claude-code, not an endless
              // "Discovering…" spinner. Emit once; keep polling so the first
              // turn's transcript switches us to showing real content.
              if (unresolvedMeansEmpty) {
                if (!sessionFile && !announcedEmpty) {
                  announcedEmpty = true;
                  offer({ kind: 'messages', messages: [], workLog: [], streaming: false, snapshot: true });
                }
                return;
              }
              // Only announce "discovering" before we've ever resolved a file, so
              // we don't blank an already-shown (empty) snapshot.
              if (!sessionFile) offer({ kind: 'discovering' });
              return;
            }
            if (resolved !== sessionFile) {
              // First resolution, or a newer transcript appeared — point the
              // watcher at it and re-parse.
              if (watcher) { try { watcher.close(); } catch { /* ignore */ } watcher = null; }
              sessionFile = resolved;
              await emit();
              if (!stopped) watchFile(resolved);
            } else {
              // Same (still-empty) file resolved — re-parse in case it grew
              // without firing a watch event (some FS/watch combos miss appends).
              await emit();
            }
          } finally {
            resolving = false;
          }
        };

        await tryResolve();
        if (!hasContent) {
          // Keep polling until the transcript has real content. Cheap readdir+stat
          // every 2s; self-stops via stopDiscovery() the moment content is parsed.
          discoveryTimer = setInterval(() => { void tryResolve(); }, 2000);
        }

        return {
          stop: () => {
            stopped = true;
            if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
            if (debounce) { clearTimeout(debounce); debounce = null; }
            if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
          },
        };
      }),
      (handle) => Effect.sync(() => handle.stop()),
    ),
  );
}

type FullParseSnapshotStream = Stream.Stream<ConversationEvent, PanRpcError>;

function ohmypiSnapshotParser(harness: unknown): (file: string) => Promise<ParseResult> {
  switch (harness) {
    case 'pi':
      return parsePiConversationMessages;
    default:
      return parseOhmypiConversationMessages;
  }
}

function streamHarnessFullParseSnapshots(
  sessionName: string,
  harness: unknown,
  model: string | null,
  unresolvedMeansEmpty = false,
): FullParseSnapshotStream | null {
  const behavior = getHarnessBehavior(harness as Parameters<typeof getHarnessBehavior>[0]);

  if (behavior.transcriptKind === 'ohmypi-jsonl') {
    return streamResolvedFullParseSnapshots(
      () => resolvePiSessionPath(sessionName),
      ohmypiSnapshotParser(harness),
      model,
      unresolvedMeansEmpty,
    );
  }

  if (behavior.transcriptKind === 'codex-rollout-jsonl') {
    return streamResolvedFullParseSnapshots(
      () => resolveCodexRolloutPath(sessionName),
      parseCodexConversationMessages,
      model,
      unresolvedMeansEmpty,
    );
  }

  return null;
}

function buildAgentIssueLookup(agents: readonly AgentIssueRecord[]): AgentIssueLookup {
  const lookup = new Map<string, string>();
  for (const agent of agents) {
    const agentId = normalizedIssueId(agent.id);
    const issueId = normalizedIssueId(agent.issueId);
    if (agentId && issueId) lookup.set(agentId, issueId);
  }
  return lookup;
}

// ─── Shared agent-issue lookup cache for subscribeIssueEvents ─────────────────
// Caches the lookup across all issue-event subscribers to avoid N× rebuilds
// per event when N drawers are open. Refreshes on TTL expiry or agent events.
const SHARED_AGENT_LOOKUP_TTL_MS = 500;
let sharedAgentLookup: AgentIssueLookup = new Map();
let sharedAgentLookupTimestamp = 0;

function getCachedAgentIssueLookup(readModel: ReadModelServiceShape): Effect.Effect<AgentIssueLookup> {
  const now = Date.now();
  if (now - sharedAgentLookupTimestamp < SHARED_AGENT_LOOKUP_TTL_MS) {
    return Effect.succeed(sharedAgentLookup);
  }
  return readModel.getSnapshot.pipe(
    Effect.map((snapshot) => {
      sharedAgentLookup = buildAgentIssueLookup(snapshot.agents);
      sharedAgentLookupTimestamp = now;
      return sharedAgentLookup;
    }),
  );
}

function recordMatchesIssue(record: unknown, issueId: string, agentIssueLookup: AgentIssueLookup = new Map()) {
  if (!record || typeof record !== 'object') return false;
  const data = record as Record<string, unknown>;
  const target = issueId.toLowerCase();
  const directIssueId = normalizedIssueId(data['issueId'] ?? data['identifier'] ?? data['id']);
  if (directIssueId === target) return true;
  const agentIssueId = normalizedIssueId((data['agent'] as Record<string, unknown> | undefined)?.['issueId']);
  if (agentIssueId === target) return true;
  const currentIssue = normalizedIssueId(data['currentIssue']);
  if (currentIssue === target) return true;
  const agentId = normalizedIssueId(data['agentId']);
  return agentId ? agentIssueLookup.get(agentId) === target : false;
}

function filterRecordsForIssue(records: unknown, issueId: string, agentIssueLookup: AgentIssueLookup) {
  return Array.isArray(records) ? records.filter((record) => recordMatchesIssue(record, issueId, agentIssueLookup)) : [];
}

export function filterDomainEventForIssue(event: DomainEvent, issueId: string, agentIssueLookup: AgentIssueLookup = new Map()): DomainEvent | null {
  const payload = event.payload as Record<string, unknown>;
  if (recordMatchesIssue(payload, issueId, agentIssueLookup)) return event;

  // Bulk replacement events (issues.snapshot, activity.updated) are excluded
  // from issue-specific streams. Their filtered payloads would replace the
  // global store's full dataset, causing every issue-dependent component to
  // re-render with incomplete data. The full bulk updates arrive via
  // subscribeDomainEvents instead.
  if (event.type === 'issues.snapshot' || event.type === 'activity.updated') {
    return null;
  }

  return null;
}

function toDiscoveredSessionSnapshot(session: DiscoveredSession) {
  return {
    id: session.id,
    jsonlPath: session.jsonlPath,
    harness: session.harness,
    sessionId: session.sessionId ?? undefined,
    workspacePath: session.workspacePath ?? undefined,
    workspaceHash: session.workspaceHash ?? undefined,
    messageCount: session.messageCount,
    firstTs: session.firstTs ?? undefined,
    lastTs: session.lastTs ?? undefined,
    modelsUsed: session.modelsUsed,
    primaryModel: session.primaryModel ?? undefined,
    tokenInput: session.tokenInput,
    tokenOutput: session.tokenOutput,
    estimatedCost: session.estimatedCost,
    toolsUsed: session.toolsUsed,
    filesTouched: session.filesTouched,
    tags: session.tags,
    summary: session.summary ?? undefined,
    summaryDetailed: session.summaryDetailed ?? undefined,
    conversationTitle: session.conversationTitle ?? undefined,
    enrichmentLevel: session.enrichmentLevel,
    enrichmentModel: session.enrichmentModel ?? undefined,
    enrichedAt: session.enrichedAt ?? undefined,
    enrichmentFailed: session.enrichmentFailed,
    overdeckManaged: session.overdeckManaged,
    panIssueId: session.panIssueId ?? undefined,
    panAgentId: session.panAgentId ?? undefined,
    scannedAt: session.scannedAt,
  };
}

const DEFAULT_CONVERSATION_LIMIT = 50;
const MAX_CONVERSATION_LIMIT = 500;

type EnrichSessionsRpcInput = {
  readonly level?: number;
  readonly ids?: readonly number[];
  readonly filter?: Readonly<ConversationFilter>;
  readonly limit?: number;
  readonly model?: string;
  readonly customPrompt?: string;
  readonly upgrade?: boolean;
  readonly confirmed?: boolean;
  readonly force?: boolean;
  readonly fullTranscript?: boolean;
};

export function buildEnrichSessionsJobPayload(input: EnrichSessionsRpcInput, config: RuntimeConversationsConfig) {
  return {
    tier: input.level,
    sessionIds: input.ids,
    filter: input.filter,
    limit: input.limit,
    maxParallel: config.enrichment.maxParallel,
    modelOverride: input.model,
    promptSuffix: input.customPrompt,
    fullTranscript: input.fullTranscript,
    skipAlreadyEnriched: input.upgrade !== true,
    force: input.confirmed === true || input.force === true,
    config,
  };
}

function normalizeConversationPagination(limit: number | undefined, offset: number | undefined): { limit: number; offset: number } {
  const normalizedLimit = limit ?? DEFAULT_CONVERSATION_LIMIT;
  const normalizedOffset = offset ?? 0;
  if (!Number.isFinite(normalizedLimit) || normalizedLimit < 0) {
    throw new PanRpcError({ message: 'Invalid limit', code: 'INVALID_LIMIT' });
  }
  if (!Number.isFinite(normalizedOffset) || normalizedOffset < 0) {
    throw new PanRpcError({ message: 'Invalid offset', code: 'INVALID_OFFSET' });
  }
  return {
    limit: Math.min(normalizedLimit, MAX_CONVERSATION_LIMIT),
    offset: normalizedOffset,
  };
}

function normalizeConversationFilter(input: {
  readonly harness?: string;
  readonly workspacePath?: string;
  readonly primaryModel?: string;
  readonly managed?: boolean;
  readonly unmanaged?: boolean;
  readonly since?: string;
  readonly before?: string;
  readonly after?: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly minMessages?: number;
  readonly tags?: readonly string[];
  readonly tools?: readonly string[];
  readonly files?: readonly string[];
  readonly issueId?: string;
  readonly enrichmentLevel?: number;
  readonly enriched?: boolean;
  readonly notEnriched?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}): ConversationFilter {
  return {
    harness: input.harness,
    workspacePath: input.workspacePath,
    primaryModel: input.primaryModel,
    managed: input.managed,
    unmanaged: input.unmanaged,
    since: input.since ? parseRelativeTime(input.since) : undefined,
    before: input.before ? parseRelativeTime(input.before) : undefined,
    after: input.after ? parseRelativeTime(input.after) : undefined,
    minCost: input.minCost,
    maxCost: input.maxCost,
    minMessages: input.minMessages,
    tags: input.tags ? [...input.tags] : undefined,
    tools: input.tools ? [...input.tools] : undefined,
    files: input.files ? [...input.files] : undefined,
    issueId: input.issueId,
    enrichmentLevel: input.enrichmentLevel,
    enriched: input.enriched,
    notEnriched: input.notEnriched,
    limit: input.limit,
    offset: input.offset,
  };
}

// ─── Session Tree Subscription Helpers (PAN-821) ──────────────────────────────

/** Extract issue ID from a tmux session name. */
export function extractIssueIdFromSession(sessionName: string): string | null {
  const issuePattern = '((?:[a-z]+-\\d+|(?:f|us|de|ta|tc)\\d+))';
  const agentMatch = sessionName.match(new RegExp(`^(agent|planning)-${issuePattern}(?:-\\d+)?$`, 'i'));
  if (agentMatch) return agentMatch[2]!.toUpperCase();

  const reviewRoleMatch = sessionName.match(new RegExp(`^agent-${issuePattern}-review(?:-[a-z]+)?$`, 'i'));
  if (reviewRoleMatch) return reviewRoleMatch[1]!.toUpperCase();

  const reviewMatch = sessionName.match(new RegExp(`^review-(?:coordinator-)?${issuePattern}-\\d+(?:-[a-z]+)?$`, 'i'));
  if (reviewMatch) return reviewMatch[1]!.toUpperCase();

  return null;
}

function reviewRoleSessionName(issueId: string): string {
  return `agent-${issueId.toLowerCase()}-review`;
}

/** Compute issue ID prefixes that belong to a project. */
function getProjectIssuePrefixes(projectKey: string): string[] {
  const projects = listProjectsSync();
  const project = projects.find(p =>
    p.key === projectKey || (p.config as { name?: string }).name === projectKey
  );
  if (!project) return [];

  const prefixes: string[] = [];
  if (project.config.issue_prefix) {
    prefixes.push(project.config.issue_prefix.toUpperCase());
  }
  if (project.config.issue_prefixes) {
    for (const p of project.config.issue_prefixes) {
      prefixes.push(p.toUpperCase());
    }
  }
  if (prefixes.length === 0) {
    prefixes.push(project.key.toUpperCase().replace(/-/g, ''));
  }
  return prefixes;
}

/** Check if an issue ID belongs to a project by prefix match. */
function issueBelongsToProject(issueId: string, prefixes: string[]): boolean {
  const prefix = issueId.split('-')[0];
  return prefix ? prefixes.includes(prefix.toUpperCase()) : false;
}

/** Map a domain event to a session tree delta. Returns null if not relevant. */
function mapEventToDelta(event: StoredEvent): SessionTreeDelta | null {
  const p = event.payload as Record<string, unknown>;
  const issueId = p['issueId'] as string | undefined;
  if (!issueId) return null;

  switch (event.type) {
    case 'agent.started': {
      const agentId = p['agentId'] as string | undefined;
      if (!agentId) return null;
      return { kind: 'session_added', issueId, sessionId: agentId, timestamp: event.timestamp };
    }
    case 'agent.stopped': {
      const agentId = p['agentId'] as string | undefined;
      if (!agentId) return null;
      return { kind: 'session_removed', issueId, sessionId: agentId, timestamp: event.timestamp };
    }
    case 'agent.status_changed': {
      const agentId = p['agentId'] as string | undefined;
      const status = p['status'] as string | undefined;
      if (!agentId || !status) return null;
      const presence: SessionNodePresence = status === 'stopped' || status === 'error'
        ? 'ended'
        : status === 'running'
          ? 'active'
          : 'idle';
      return {
        kind: 'status_changed',
        issueId,
        sessionId: agentId,
        status: status as AgentStatus,
        presence,
        timestamp: event.timestamp,
      };
    }
    case 'specialist.started': {
      const name = p['name'] as string | undefined;
      const currentIssue = p['currentIssue'] as string | undefined;
      if (!name) return null;
      return {
        kind: 'session_added',
        issueId: currentIssue || issueId,
        sessionId: name,
        timestamp: event.timestamp,
      };
    }
    case 'specialist.completed':
    case 'specialist.failed': {
      const name = p['name'] as string | undefined;
      if (!name) return null;
      return { kind: 'session_removed', issueId, sessionId: name, timestamp: event.timestamp };
    }
    case 'pipeline.review-started': {
      return {
        kind: 'session_added',
        issueId,
        sessionId: reviewRoleSessionName(issueId),
        timestamp: event.timestamp,
      };
    }
    case 'pipeline.review-completed': {
      return {
        kind: 'session_removed',
        issueId,
        sessionId: reviewRoleSessionName(issueId),
        timestamp: event.timestamp,
      };
    }
    case 'planning.started': {
      const sessionName = p['sessionName'] as string;
      return { kind: 'session_added', issueId, sessionId: sessionName, timestamp: event.timestamp };
    }
    default:
      return null;
  }
}

/**
 * Shared singleton poller for tmux presence changes.
 * One interval polls tmux and fans out to all subscribers,
 * avoiding O(subscribers) subprocess QPS.
 */
const sharedPresencePoller: {
  refCount: number;
  interval: NodeJS.Timeout | null;
  knownSessions: Set<string>;
  subscribers: Set<(d: SessionTreeDelta) => void>;
} = {
  refCount: 0,
  interval: null,
  knownSessions: new Set(),
  subscribers: new Set(),
};

function startSharedPresencePoller(): void {
  if (sharedPresencePoller.interval) return;

  const tick = async () => {
    try {
      const sessions = await Effect.runPromise(listSessionNames());
      const current = new Set(sessions.filter(s => s.trim()));

      for (const s of sharedPresencePoller.knownSessions) {
        if (!current.has(s)) {
          const issueId = extractIssueIdFromSession(s);
          if (issueId) {
            const delta: SessionTreeDelta = {
              kind: 'presence_changed',
              issueId,
              sessionId: s,
              presence: 'ended',
              timestamp: new Date().toISOString(),
            };
            for (const sub of sharedPresencePoller.subscribers) {
              try { sub(delta); } catch { /* ignore subscriber errors */ }
            }
          }
        }
      }

      sharedPresencePoller.knownSessions = current;
    } catch { /* tmux may not be available, ignore */ }
  };

  sharedPresencePoller.interval = setInterval(tick, 2000);
  tick();
}

function stopSharedPresencePoller(): void {
  if (sharedPresencePoller.interval) {
    clearInterval(sharedPresencePoller.interval);
    sharedPresencePoller.interval = null;
  }
  sharedPresencePoller.knownSessions.clear();
}

/**
 * Create a stream that subscribes to the shared presence poller.
 * Tracks tmux session existence and emits presence_changed deltas when
 * sessions disappear (→ ended).
 *
 * NOTE: The poller only emits on session *disappearance* (ended), not on
 * session *appearance*. New sessions are discovered via the event stream
 * (session_added deltas) or the next periodic snapshot refetch. This is
 * intentional — the event stream handles arrivals, and the poller handles
 * cleanup of stale presence state.
 */
function createPresencePollStream(): Stream.Stream<SessionTreeDelta, never, never> {
  return Stream.callback<SessionTreeDelta>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        sharedPresencePoller.refCount++;
        if (sharedPresencePoller.refCount === 1) {
          startSharedPresencePoller();
        }

        const subscriber = (d: SessionTreeDelta) => {
          Queue.offerUnsafe(queue, d);
        };
        sharedPresencePoller.subscribers.add(subscriber);
        return subscriber;
      }),
      (subscriber) =>
        Effect.sync(() => {
          sharedPresencePoller.subscribers.delete(subscriber);
          sharedPresencePoller.refCount--;
          if (sharedPresencePoller.refCount === 0) {
            stopSharedPresencePoller();
          }
        }),
    ),
  );
}

// ─── RPC handler layer ────────────────────────────────────────────────────────

const PanRpcLayer = PanRpcGroup.toLayer(
  Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const readModel = yield* ReadModelService;
    const terminalService = yield* TerminalService;
    const panOpen = yield* PanOpen;

    // PAN-1249: handler set is incomplete — missing routes are stubbed by other code paths.
    // Suppress the exhaustiveness check until the missing handlers are reintegrated.
    // @ts-expect-error — missing handlers (getWorkspaceDetail, startPlanning, startAgent, deepWipe, etc.)
    return PanRpcGroup.of({
      // ── subscribeDomainEvents ────────────────────────────────────────────────
      [WS_METHODS.subscribeDomainEvents]: (_input) => {
        console.log('[ws-rpc] subscribeDomainEvents invoked');
        const heartbeats = Stream.tick('15 seconds').pipe(
          Stream.map(createSystemHeartbeatEvent),
        );
        return eventStore.streamEvents.pipe(
          Stream.map(storedToDomainEvent),
          Stream.merge(heartbeats),
        );
      },

      [WS_METHODS.subscribeFlywheelStatus]: (_input) =>
        Stream.callback((queue) =>
          Effect.acquireRelease(
            Effect.promise(async () => {
              const activeRunId = await runDashboardDbJob<string | null>('getSetting', 'flywheel.active_run_id');
              const latest = await readCurrentLatestFlywheelStatus({ activeRunId });
              if (latest) Queue.offerUnsafe(queue, latest);
              return subscribeLatestFlywheelStatus((status) => {
                Queue.offerUnsafe(queue, status);
              });
            }),
            (unsubscribe) => Effect.sync(() => unsubscribe()),
          ),
        ),

      // ── subscribeIssueEvents ──────────────────────────────────────────────────
      [WS_METHODS.subscribeIssueEvents]: (input) => {
        console.log(`[ws-rpc] subscribeIssueEvents invoked issueId=${input.issueId}`);
        return eventStore.streamEvents.pipe(
          Stream.map(storedToDomainEvent),
          Stream.mapEffect((event) =>
            getCachedAgentIssueLookup(readModel).pipe(
              Effect.map((lookup) => filterDomainEventForIssue(event, input.issueId, lookup)),
            ),
          ),
          Stream.filter((event): event is DomainEvent => event !== null),
        );
      },

      // ── subscribeTerminal — live PTY stream (B20) ────────────────────────────
      [WS_METHODS.subscribeTerminal]: (input) =>
        terminalService.streamSession(input.sessionName, input.cols, input.rows),

      // ── subscribeAgentOutput — live agent stdout lines ───────────────────────
      // Filtered view of the domain event stream for a specific agent
      [WS_METHODS.subscribeAgentOutput]: (input) =>
        eventStore.streamEvents.pipe(
          Stream.filter(
            (e) => e.type === 'agent.output_received' &&
              (e.payload as Record<string, unknown>)['agentId'] === input.agentId,
          ),
          Stream.flatMap((e) => {
            const payload = e.payload as { agentId: string; lines: string[] };
            return Stream.fromIterable(
              payload.lines.map((line) => ({ agentId: payload.agentId, line })),
            );
          }),
        ),

      // ── getSnapshot — returns clean read model data (PAN-433) ─────────────────
      [WS_METHODS.getSnapshot]: (_input) =>
        Effect.gen(function* () {
          const t0 = Date.now();
          console.log('[ws-rpc] getSnapshot invoked');
          const snapshot = yield* readModel.getSnapshot;
          const issuesLen = Array.isArray(snapshot.issues) ? snapshot.issues.length : 'none';
          const agentsLen = Array.isArray(snapshot.agents) ? snapshot.agents.length : 'none';
          console.log(`[ws-rpc] getSnapshot resolved in ${Date.now() - t0}ms — agents=${agentsLen} issues=${issuesLen} seq=${snapshot.sequence}`);
          return snapshot;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new PanRpcError({
                message: `Failed to build dashboard snapshot: ${String(cause)}`,
                code: 'SNAPSHOT_FAILED',
              }),
          ),
        ),

      // ── replayEvents ─────────────────────────────────────────────────────────
      [WS_METHODS.replayEvents]: (input) =>
        eventStore.readFrom(input.fromSequence).pipe(
          Effect.map((stored) => stored.map(storedToDomainEvent)),
          Effect.mapError(
            (cause) =>
              new PanRpcError({
                message: `Failed to replay events: ${String(cause)}`,
                code: 'REPLAY_FAILED',
              }),
          ),
        ),

      // ── terminalOpen — live PTY (B20) ───────────────────────────────────────
      [WS_METHODS.terminalOpen]: (input) =>
        terminalService.open(input.sessionName, input.cols, input.rows),

      // ── terminalWrite — live PTY (B20) ──────────────────────────────────────
      [WS_METHODS.terminalWrite]: (input) =>
        terminalService.write(input.sessionName, input.data),

      // ── terminalResize — live PTY (B20) ─────────────────────────────────────
      [WS_METHODS.terminalResize]: (input) =>
        terminalService.resize(input.sessionName, input.cols, input.rows),

      // ── terminalClose — live PTY (B20) ──────────────────────────────────────
      [WS_METHODS.terminalClose]: (input) =>
        terminalService.close(input.sessionName),

      // ── subscribeConversationMessages — live JSONL stream (PAN-451) ──────────
      [WS_METHODS.subscribeConversationMessages]: (input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const conv = getConversationByName(input.conversationName);

            // PAN-1908: synthetic agent sessions (work/planning/specialist panels)
            // have no conversations-table row. Stream pi/codex work agents by
            // tailing their transcript and pushing full snapshots. Claude agent
            // sessions keep the HTTP-poll path — the front-end gate only enables
            // streaming for pi/codex here.
            if (!conv && /^(agent-|planning-|specialist-|strike-|inspect-)|^(flywheel-orchestrator|conv-flywheel-orchestrator)$/.test(input.conversationName)) {
              const harness = yield* Effect.promise(() => resolveAgentHarness(input.conversationName));
              const stream = streamHarnessFullParseSnapshots(input.conversationName, harness, null);
              if (stream) return stream;
              return conversationDiscoveringStream();
            }

            if (!conv) {
              return conversationDiscoveringStream();
            }

            const stream = streamHarnessFullParseSnapshots(conv.tmuxSession, conv.harness, conv.model ?? null, true);
            if (stream) return stream;

            if (getHarnessBehavior(conv.harness).transcriptKind !== 'claude-jsonl') {
              return conversationDiscoveringStream();
            }

            // Resolve the live session id from the launcher's pinned --session-id
            // FIRST (ground truth — the exact session the running pane uses), then
            // fall back to the conversations-table claudeSessionId. This mirrors
            // resolveSessionFile() on the REST /messages path. Without it the live
            // stream resolved ONLY via claudeSessionId, which the read door derives
            // as the OLDEST conversation_files locator (`ORDER BY created_at ASC`).
            // For a re-run singleton (e.g. the Backlog Sequencer) that oldest
            // locator is a stale/never-written session, so the stream tailed a
            // missing file and the panel showed the empty "How can I help you?"
            // state even though the terminal showed the live run (PAN-1866).
            const launcherTmuxSession = conv.tmuxSession;
            const pinnedSessionId = launcherTmuxSession
              ? yield* Effect.promise(() => readLauncherPinnedSessionId(launcherTmuxSession))
              : null;
            const resolvedSessionId = pinnedSessionId ?? conv.claudeSessionId;
            const sessionFile = resolvedSessionId
              ? sessionFilePath(conv.cwd, resolvedSessionId)
              : null;
            const model = conv.model ?? null;

            if (!sessionFile) {
              // Session file not yet discovered — keep the subscription alive
              // without causing the client to reconnect in a tight loop.
              return conversationDiscoveringStream();
            }

            if (isPiSessionFile(sessionFile)) {
              // Pi session files use a different JSONL schema and must not be
              // routed through the Claude-only incremental watcher.
              return conversationDiscoveringStream();
            }

            return Stream.callback<ConversationEvent, PanRpcError>((queue) =>
              Effect.acquireRelease(
                Effect.promise(async () => {
                  const offer = (event: ConversationEvent) => {
                    try {
                      Queue.offerUnsafe(queue, event);
                    } catch {
                      // The queue may be shut down if the client disconnected
                      // while an async file watcher callback was still running.
                    }
                  };

                  // Parse the complete existing transcript before subscribing to
                  // appends. Keep pending tool_use entries in parser state for the
                  // watcher instead of flushing them into the display-only work log.
                  const initial = await parseEntireConversation(sessionFile, { flushPendingToolUse: false });
                  let currentByteOffset = initial.byteOffset;
                  let currentContextUsage = contextUsageFromParseResult(initial, model);
                  // Per-subscription high-water mark of the largest full transcript
                  // we have emitted as an authoritative snapshot. The append-only
                  // guard (gateSnapshotEmission) uses it to refuse any later
                  // reset-snapshot that would shrink the transcript. See PAN-1642.
                  let highWaterCount = initial.messages.length;
                  if (initial.messages.length === 0 && currentByteOffset > 0) {
                    // The file has complete lines on disk yet parsed to zero
                    // messages — a transient read during a respawn rewrite, or a
                    // transcript shape we failed to parse. Logged (not fatal) so a
                    // recurring blank-on-subscribe can be correlated with respawns.
                    console.warn(
                      `[conv-stream] initial parse of ${input.conversationName} yielded 0 messages ` +
                      `despite byteOffset=${currentByteOffset} — emitting empty snapshot (client HTTP backfill covers this)`,
                    );
                  }
                  const priorState: ParseState = {
                    pendingToolUse: initial.pendingToolUse,
                    unresolvedResults: initial.unresolvedResults,
                    lastSequence: initial.lastSequence,
                    planToolUseIds: initial.planToolUseIds,
                    proposedPlan: initial.proposedPlan,
                    latestAssistantUsage: initial.latestAssistantUsage,
                    contextBoundaryOffset: initial.contextBoundaryOffset,
                    permissionMode: initial.permissionMode,
                    countedUsageIds: initial.countedUsageIds,
                    fileEditsByAssistantId: initial.fileEditsByAssistantId,
                    pendingAssistantId: initial.pendingAssistantId,
                    orphanToolUseIds: initial.orphanToolUseIds,
                  };

                  offer({
                    kind: 'messages' as const,
                    messages: initial.messages,
                    workLog: [...initial.workLog, ...initial.pendingToolUse.values()],
                    streaming: initial.streaming,
                    snapshot: true,
                    proposedPlan: initial.proposedPlan,
                    compactBoundaries: initial.compactBoundaries && initial.compactBoundaries.length > 0 ? initial.compactBoundaries : undefined,
                    contextUsage: currentContextUsage,
                  });

                  // Watch only bytes written after the initial full parse. Subsequent
                  // events are deltas; the client merges them into its cache.
                  const handle = watchConversation(sessionFile, (result) => {
                    const fileWasReset = result.byteOffset < currentByteOffset;
                    // Append-only guard: a watcher reset fires only when the file
                    // shrank and was re-parsed from byte 0, so result.messages is a
                    // full transcript. claude-code transcripts never legitimately
                    // shrink on a stable subscription (resume reuses the same file;
                    // compaction appends), so a smaller full re-parse is a transient
                    // rewrite window — downgrade it to a merge instead of letting it
                    // wipe the reader's view to "How can I help you?" (PAN-1642).
                    const gate = gateSnapshotEmission(fileWasReset, result.messages.length, highWaterCount);
                    highWaterCount = gate.highWaterCount;
                    currentByteOffset = result.byteOffset;
                    currentContextUsage = contextUsageFromParseResult(result, model);
                    if (gate.suppressedShrink) {
                      console.warn(
                        `[conv-stream] suppressed shrinking reset for ${input.conversationName}: ` +
                        `byteOffset ${currentByteOffset} (re-parsed ${result.messages.length} msgs) < ` +
                        `high-water ${highWaterCount} — treating as transient rewrite, merging instead of replacing`,
                      );
                    }
                    offer({
                      kind: 'messages' as const,
                      messages: result.messages,
                      workLog: result.workLog,
                      streaming: result.streaming,
                      snapshot: gate.snapshot,
                      proposedPlan: result.proposedPlan,
                      compactBoundaries: result.compactBoundaries && result.compactBoundaries.length > 0 ? result.compactBoundaries : undefined,
                      contextUsage: currentContextUsage,
                    });
                  }, { byteOffset: initial.byteOffset, priorState });

                  return handle;
                }),
                (handle) =>
                  Effect.sync(() => {
                    handle.stop();
                  }),
              ),
            );
          }),
        ),

      // ── subscribeProjectSessionTree — live session tree deltas (PAN-821) ─────
      [WS_METHODS.subscribeProjectSessionTree]: (input) =>
        Effect.gen(function* () {
          const prefixes = getProjectIssuePrefixes(input.projectKey);

          const eventDeltas = eventStore.streamEvents.pipe(
            Stream.map(mapEventToDelta),
            Stream.filter((d): d is SessionTreeDelta => d !== null),
            Stream.filter(d => issueBelongsToProject(d.issueId, prefixes)),
          );

          const pollDeltas = createPresencePollStream().pipe(
            Stream.filter(d => issueBelongsToProject(d.issueId, prefixes)),
          );

          return Stream.merge(eventDeltas, pollDeltas);
        }).pipe(Stream.unwrap),

      // ── shellOpenInEditor — open workspace in editor (PAN-966) ──────────────
      [WS_METHODS.shellOpenInEditor]: (input) =>
        panOpen.openInEditor(input),

      [WS_METHODS.readWorkspaceFile]: (input) =>
        readWorkspaceFileEffect(input),

      [WS_METHODS.resolveFilePathExists]: (input) =>
        resolveFilePathExistsEffect(input),

      // ── getAvailableEditors — list detected editors (PAN-966) ───────────────
      [WS_METHODS.getAvailableEditors]: () =>
        Effect.all({
          editors: panOpen.getAvailableEditors(),
          defaultCwd: panOpen.getDefaultCwd(),
        }),

      [WS_METHODS.scanConversations]: (input) =>
        getConversationsConfig().pipe(
          Effect.flatMap((config) => Effect.promise(async () => {
            await Effect.runPromise(eventStore.appendAsync({
              type: 'scan.started',
              timestamp: new Date().toISOString(),
              payload: { mode: input.mode, dirs: input.dirs ?? [] },
            } as ScanStartedEvent));
            let lastProgressEmit = 0;
            const result = await runDashboardDbJob<{
              inserted: number;
              updated: number;
              skipped: number;
              errors: number;
              durationMs: number;
            }>('scanConversations', {
              mode: input.mode,
              dirs: input.dirs,
              dryRun: input.dryRun,
              watchDirs: config.watchDirs,
              maxParallel: config.scanMaxParallel,
            }, async (rawProgress) => {
              const progress = rawProgress as {
                dirsProcessed: number;
                dirsTotal: number;
                sessionsFound: number;
                elapsedMs: number;
              };
              const now = Date.now();
              const complete = progress.dirsProcessed >= progress.dirsTotal;
              if (!complete && now - lastProgressEmit < 500) return;
              lastProgressEmit = now;
              await Effect.runPromise(eventStore.appendAsync({
                type: 'scan.progress',
                timestamp: new Date().toISOString(),
                payload: progress,
              } as ScanProgressEvent));
            });
            await Effect.runPromise(eventStore.appendAsync({
              type: 'scan.complete',
              timestamp: new Date().toISOString(),
              payload: {
                inserted: result.inserted,
                updated: result.updated,
                skipped: result.skipped,
                errors: result.errors,
                durationMs: result.durationMs,
              },
            } as ScanCompleteEvent));
            return result;
          })),
        ),

      [WS_METHODS.searchConversations]: (input) =>
        getConversationsConfig().pipe(
          Effect.flatMap((config) => Effect.promise(async () => {
            const pagination = normalizeConversationPagination(input.limit, input.offset);
            const filter = { ...normalizeConversationFilter(input), ...pagination };
            try {
              const operation = input.semantic === true ? 'searchSessionsSemantic' : 'searchSessions';
              const result = await runDashboardDbJob<SearchResult>(operation, {
                q: input.semantic === true ? undefined : input.query,
                semanticQuery: input.semantic === true ? input.query : undefined,
                similarTo: input.similarTo,
                filter,
                limit: pagination.limit,
                offset: pagination.offset,
                config,
              });
              return {
                ...result,
                sessions: result.sessions.map(toDiscoveredSessionSnapshot),
              };
            } catch (err) {
              if (input.semantic === true) {
                return {
                  sessions: [],
                  total: 0,
                  mode: 'semantic',
                  durationMs: 0,
                  error: err instanceof Error ? err.message : String(err),
                };
              }
              throw err;
            }
          })),
        ),

      [WS_METHODS.listDiscoveredSessions]: (input) =>
        Effect.promise(async () => {
          const filter = {
            ...normalizeConversationFilter(input),
            ...normalizeConversationPagination(input.limit, input.offset),
          };
          const { sessions, total } = await runDashboardDbJob<{ sessions: DiscoveredSession[]; total: number }>('listDiscoveredSessions', filter);
          return { sessions: sessions.map(toDiscoveredSessionSnapshot), count: sessions.length, total };
        }),

      [WS_METHODS.getDiscoveredSession]: (input) =>
        Effect.promise(async () => {
          const session = await runDashboardDbJob<DiscoveredSession | null>('getDiscoveredSessionById', input.id);
          if (!session) {
            throw new PanRpcError({ message: `Session ${input.id} not found`, code: 'NOT_FOUND' });
          }
          return toDiscoveredSessionSnapshot(session);
        }).pipe(
          Effect.mapError((cause: unknown) => cause instanceof PanRpcError
            ? cause
            : new PanRpcError({ message: String(cause), code: 'GET_DISCOVERED_SESSION_FAILED' })),
        ),

      [WS_METHODS.enrichSessions]: (input) =>
        getConversationsConfig().pipe(
          Effect.flatMap((config) => Effect.promise(async () => {
            try {
              const result = await runDashboardDbJob<{
                enriched: number;
                errors: number;
                estimatedCost: number;
                actualCost: number | null;
                durationMs: number;
              }>('enrichSessions', buildEnrichSessionsJobPayload(input as EnrichSessionsRpcInput, config), async (rawProgress) => {
                const progress = rawProgress as {
                  session?: { sessionId: number; tier: number; model: string; cost?: number; success: boolean; error?: string };
                };
                if (!progress.session) return;
                const { session } = progress;
                await Effect.runPromise(eventStore.appendAsync({
                  type: 'enrich.progress',
                  timestamp: new Date().toISOString(),
                  payload: {
                    sessionId: session.sessionId,
                    level: session.tier,
                    model: session.model,
                    cost: session.cost ?? 0,
                    success: session.success,
                    error: session.error,
                  },
                } as EnrichProgressEvent));
              });
              const processed = result.enriched + result.errors;
              await Effect.runPromise(eventStore.appendAsync({
                type: 'enrich.complete',
                timestamp: new Date().toISOString(),
                payload: { processed, totalCost: result.actualCost ?? result.estimatedCost, failures: result.errors, durationMs: result.durationMs },
              } as EnrichCompleteEvent));
              return { processed, totalCost: result.actualCost ?? result.estimatedCost, failures: result.errors };
            } catch (err) {
              if (err instanceof CostThresholdError) {
                throw new PanRpcError({
                  message: err.message,
                  code: `COST_THRESHOLD:${err.estimatedCost}:${err.threshold}:${err.sessionCount}`,
                });
              }
              throw err;
            }
          })),
        ),

      [WS_METHODS.embedSessions]: (input) =>
        getConversationsConfig().pipe(
          Effect.flatMap((config) => Effect.promise(async () => {
            const result = await runDashboardDbJob<{ embedded: number; skipped: number; errors: number }>('embedSessions', {
              sessionIds: input.ids,
              regenerate: input.regenerate,
              config,
            }, async (rawProgress) => {
              const progress = rawProgress as {
                session?: { sessionId: number; model: string; success: boolean; error?: string };
              };
              if (!progress.session) return;
              await Effect.runPromise(eventStore.appendAsync({
                type: 'embed.progress',
                timestamp: new Date().toISOString(),
                payload: progress.session,
              } as EmbedProgressEvent));
            });
            return { total: result.embedded + result.skipped + result.errors, embedded: result.embedded, model: config.embeddingModel };
          })),
        ),

      [WS_METHODS.getConversationCost]: (input) =>
        Effect.promise(async () => runDashboardDbJob('aggregateDiscoveredSessionCost', normalizeConversationFilter(input))),

      [WS_METHODS.getConversationCostByWorkspace]: (input) =>
        Effect.promise(async () => runDashboardDbJob('aggregateDiscoveredSessionCostBy', {
          groupBy: 'workspace',
          filter: normalizeConversationFilter(input),
        })),

      [WS_METHODS.getConversationStats]: () =>
        Effect.promise(async () => runDashboardDbJob('getDiscoveredStats')),
    });
  }),
);

// ─── WebSocket route layer ────────────────────────────────────────────────────

/**
 * Layer that registers GET /ws/rpc as the WebSocket RPC endpoint.
 * The transport layer (WsRpcLayer + RpcSerialization.layerJson) is
 * provided inline so only ServerConfig leaks into the outer composition.
 */
export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttp = yield* RpcServer.toHttpEffectWebsocket(PanRpcGroup).pipe(
      Effect.provide(
        Layer.mergeAll(
          PanRpcLayer,
          RpcSerialization.layerJson,
        ),
      ),
    );

    return HttpRouter.add('GET', '/ws/rpc', Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      // Hotfix for #1166: PAN-457's cookie-auth gate is removed here for the
      // same reason as ws-terminal — origin validation is the security
      // boundary for browser callers, and the cookie can't be minted without
      // the URL-hash bootstrap that only `pan up` injects.
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, { status: 403 });
      }
      return yield* rpcWebSocketHttp;
    }));
  }),
);
