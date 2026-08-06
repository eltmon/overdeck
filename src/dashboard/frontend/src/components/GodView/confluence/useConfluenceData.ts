import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentRuntimeSnapshot, AgentSnapshot, DomainEvent, ReviewStatusSnapshot } from '@overdeck/contracts';
import { useGodViewStore } from '../../../hooks/useGodViewSocket';
import {
  subscribeDashboardDomainEvents,
  useDashboardStore,
} from '../../../lib/store';
import type { Issue } from '../../../types';
import { useWorkspaceStackHealthQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries';
import {
  HOOK_KEYS,
  classifyOrb,
  modelGlyph,
  toolToFamily,
  type HookFamilyKey,
  type OrbState,
  type Stage,
} from './model';

const HOOK_STREAM_LIMIT = 500;
const EVENT_WINDOW_MS = 60_000;
const RATE_DECAY_MS = 1_600;
const RATE_BUMP = 0.13;
const MICRO_STATE_HOLD_MS = 30 * 60_000;
const COMPACT_DURATION_SECONDS = 0.9;

export interface ConfluenceConvoyMember {
  agentId: string;
  role: string;
  model: string | null;
  status: string;
}

export interface ConfluenceOrb {
  id: string;
  project: string;
  role: string;
  stage: Stage;
  title: string;
  heat: number;
  staleMin: number;
  state: OrbState;
  convoy: readonly ConfluenceConvoyMember[] | null;
  yieldReason: string | null;
  yieldedByScheduler: boolean;
  warn: string | null;
  broken: boolean;
  model: string | null;
  harness: string | null;
  labels: readonly string[];
  glyph: string | null;
  lastActivity: string | null;
  idleMin: number;
  waitUntil: number;
  thinkUntil: number;
  compactT: number;
  spend: number;
  mergeStatus: string | null;
  /** PAN-3490: the issue's primary parked orbit (most severe), null when not parked. */
  parkedOrbit: string | null;
  /** Minutes since the park began (parkedAt age), null when not parked. */
  parkedMin: number | null;
  /** Operator sentence — why the issue is parked (tooltip/rail copy). */
  orbitReason: string | null;
}

/** The /api/parked row shape (PAN-3486) — the God View's parked cast source. */
export interface ParkedRowView {
  issueId: string;
  orbit: string;
  parkedAt: string;
  parkReason: string;
  unparkCondition: string;
  details?: Record<string, unknown>;
}

export interface ParkedResponse {
  rows: ParkedRowView[];
  summary: { total: number; byOrbit: Record<string, number>; primaryByIssue: Record<string, string> };
}

export interface HookStreamEntry {
  sequence: number;
  source: 'hook' | 'lifecycle';
  agentId: string;
  issueId: string | null;
  tool: string;
  hookName: string;
  family: HookFamilyKey;
  ts: number;
}

export interface ConfluenceMicroState {
  thinkUntil: number;
  waitUntil: number;
  compactT: number;
  spend: number;
}

interface CostPulse {
  agentId: string;
  issueId: string | null;
  cost: number;
  ts: number;
}

export interface ConfluenceHookStream {
  entries: readonly HookStreamEntry[];
  eventTimes: readonly number[];
  eventsPerMin: number;
  eventsPerSec: number;
  specRates: Readonly<Record<HookFamilyKey, number>>;
  energy: number;
  microStatesByAgentId: Readonly<Record<string, ConfluenceMicroState>>;
  costEvents: readonly CostPulse[];
}

export interface ConfluenceBeadCounts {
  wip: number;
  blocked: number;
  ready: number;
}

export interface ConfluenceMeta {
  mergesToday: number;
  tokensToday: number | null;
  costPerMin: number | null;
  mergeQ: number;
  conversations: number | null;
  staleTotal: number;
  oldestIdle: number;
  beads: ConfluenceBeadCounts | null;
  system: ReturnType<typeof useGodViewStore.getState>['systemHealth'];
  active: number;
  total: number;
  roleCounts: Readonly<Record<string, number>>;
  /** PAN-3490: parked population size + orbit histogram (null while /api/parked has never answered). */
  parkedTotal: number | null;
  parkedByOrbit: Readonly<Record<string, number>> | null;
  /** PAN-3491: real stage transitions over the trailing hour (null while /api/velocity has never answered). */
  velocity: { transitionsPerHour: number; byStage: Record<string, number> } | null;
}

export interface ConfluenceData {
  orbs: readonly ConfluenceOrb[];
  hookStream: ConfluenceHookStream;
  meta: ConfluenceMeta;
}

type IssueRecord = Issue & Record<string, unknown>;
type WorkspaceHealthRecord = Record<string, {
  stackHealth?: { healthy?: boolean };
}>;

const EMPTY_WORKSPACE_HEALTH: WorkspaceHealthRecord = {};
const EMPTY_MICRO_STATES: Readonly<Record<string, ConfluenceMicroState>> = {};

function emptySpecRates(): Record<HookFamilyKey, number> {
  return Object.fromEntries(HOOK_KEYS.map((key) => [key, 0])) as Record<HookFamilyKey, number>;
}

function emptyHookStream(): ConfluenceHookStream {
  return {
    entries: [],
    eventTimes: [],
    eventsPerMin: 0,
    eventsPerSec: 0,
    specRates: emptySpecRates(),
    energy: 0,
    microStatesByAgentId: {},
    costEvents: [],
  };
}

function issueKey(issue: IssueRecord): string {
  return String(issue.identifier || issue.id || '').toUpperCase();
}

function issueProject(issueId: string): string {
  const prefix = issueId.split('-')[0]?.toLowerCase();
  return prefix === 'pan' ? 'overdeck' : prefix || 'overdeck';
}

/**
 * Event-driven liveness (PAN-3490 follow-up, operator-directed): the orb's
 * "is it working" stamp must come from the EVENT STREAM, not the polled
 * snapshot. AgentSnapshot.lastActivity only moves on the enrichment poller's
 * cadence (polling), so orbs read idle while agents work and running while
 * they sit. agentRuntimeById.lastActivity is stamped by every real domain
 * event — tool beats (agent.activity_changed), thinking/waiting transitions,
 * messages — so it is current within a beat. Take the fresher of the two.
 */
function effectiveStamp(agent: AgentSnapshot, runtime: AgentRuntimeSnapshot | undefined): string | null {
  const snap = agent.lastActivity ?? agent.startedAt ?? null;
  const rt = runtime?.lastActivity ?? null;
  if (rt && (!snap || rt > snap)) return rt;
  return snap;
}

function latestActivity(agents: readonly AgentSnapshot[], runtimeById: Readonly<Record<string, AgentRuntimeSnapshot>>): string | null {
  let latest: string | null = null;
  for (const agent of agents) {
    const candidate = effectiveStamp(agent, runtimeById[agent.id]);
    if (candidate && (!latest || candidate > latest)) latest = candidate;
  }
  return latest;
}

function activeStatus(status: AgentSnapshot['status']): boolean {
  return status === 'running' || status === 'starting';
}

/** "Active" means PRODUCING, not registered: activity inside this window. */
const ACTIVE_RECENT_WINDOW_MS = 15 * 60_000;

function recentlyActive(agent: AgentSnapshot, runtime: AgentRuntimeSnapshot | undefined, now: number): boolean {
  if (!activeStatus(agent.status)) return false;
  const stamp = Date.parse(effectiveStamp(agent, runtime) ?? '');
  return Number.isFinite(stamp) && now - stamp < ACTIVE_RECENT_WINDOW_MS;
}

/** Agent statuses that mean the agent is (or could imminently be) working the issue.
 * Registry rows for long-dead agents of closed-out issues must NOT put an orb on
 * the river — that residue is what once flooded the doldrums with 90+ closed issues.
 * running/starting always count; degraded/paused statuses count only when the
 * issue is known-open, so ancient stuck/paused rows of untracked or closed issues
 * (e.g. LEX-1) cannot resurrect an orb. */
const ALWAYS_LIVE_STATUSES = new Set<string>(['running', 'starting']);
const CONDITIONAL_LIVE_STATUSES = new Set<string>(['healthy', 'warning', 'stuck', 'stalled']);
const ACTIVE_MERGE_STATUSES = new Set<string>(['pending', 'queued', 'merging', 'verifying']);
/** Doldrums emissary cap — mirrors the mockup's "few emissaries of the N frozen" pattern
 * so a large stale population never becomes an unreadable label wall. */
const STALE_ORB_LIMIT = 14;

function closedIssueState(issue: IssueRecord | undefined): boolean {
  if (!issue) return false;
  const state = String(issue.state ?? issue.status ?? '').toLowerCase();
  return state === 'closed' || state === 'done' || state === 'completed' || state === 'cancelled';
}

function reviewSubRole(agent: AgentSnapshot): string | null {
  if (agent.role !== 'review' && !agent.id.includes('-review')) return null;
  const match = agent.id.match(/-review-(security|correctness|performance|requirements|synthesis)$/i);
  if (match?.[1]) return match[1].toLowerCase();
  if (/-review$/i.test(agent.id)) return 'synthesis';
  return 'review';
}

function convoyMembers(agents: readonly AgentSnapshot[]): ConfluenceConvoyMember[] | null {
  const members = new Map<string, ConfluenceConvoyMember>();
  for (const agent of agents) {
    const role = reviewSubRole(agent);
    if (!role) continue;
    members.set(role, {
      agentId: agent.id,
      role,
      model: agent.model ?? null,
      status: agent.status,
    });
  }
  if (members.size === 0) return null;
  const order = ['security', 'correctness', 'performance', 'requirements', 'synthesis', 'review'];
  return [...members.values()].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

function mergedPendingCloseout(issue: IssueRecord | undefined, review: ReviewStatusSnapshot | undefined): boolean {
  if (review?.mergeStatus !== 'merged') return false;
  const state = String(issue?.state ?? issue?.status ?? '').toLowerCase();
  return state !== 'done' && state !== 'closed' && state !== 'completed';
}

function orbStage(
  agents: readonly AgentSnapshot[],
  issue: IssueRecord | undefined,
  review: ReviewStatusSnapshot | undefined,
): Stage {
  const mergeStatus = review?.mergeStatus ?? issue?.mergeStatus;
  if (mergeStatus === 'queued' || mergeStatus === 'merging') return 'MERGE';
  if (mergeStatus === 'verifying' || mergedPendingCloseout(issue, review)) return 'VERIFY';
  if (agents.some((agent) => agent.role === 'test')) return 'TEST';
  if (agents.some((agent) => agent.role === 'review' || agent.id.includes('-review'))) return 'REVIEW';
  if (agents.some((agent) => agent.role === 'plan')) return 'PLAN';
  return 'WORK';
}

function primaryAgent(agents: readonly AgentSnapshot[], stage: Stage): AgentSnapshot {
  const role = stage === 'PLAN' ? 'plan'
    : stage === 'REVIEW' ? 'review'
      : stage === 'TEST' ? 'test'
        : stage === 'VERIFY' || stage === 'MERGE' ? 'ship'
          : 'work';
  return agents.find((agent) => agent.role === role && activeStatus(agent.status))
    ?? agents.find((agent) => activeStatus(agent.status))
    ?? agents[0]!;
}

function aggregateMicroState(
  agents: readonly AgentSnapshot[],
  microStates: Readonly<Record<string, ConfluenceMicroState>>,
): ConfluenceMicroState {
  const state: ConfluenceMicroState = { thinkUntil: 0, waitUntil: 0, compactT: 0, spend: 0 };
  for (const agent of agents) {
    const micro = microStates[agent.id];
    if (!micro) continue;
    state.thinkUntil = Math.max(state.thinkUntil, micro.thinkUntil);
    state.waitUntil = Math.max(state.waitUntil, micro.waitUntil);
    state.compactT = Math.max(state.compactT, micro.compactT);
    state.spend += micro.spend;
  }
  return state;
}

function orbSignature(orb: ConfluenceOrb): string {
  return JSON.stringify(orb, (key, value) =>
    key === 'staleMin' || key === 'idleMin' || key === 'parkedMin' ? undefined : value,
  );
}

function telemetryEntry(event: DomainEvent, agentsById: Record<string, AgentSnapshot>): HookStreamEntry | null {
  let agentId: string | undefined;
  let tool: string | undefined;
  let hookName: string | undefined;
  let source: HookStreamEntry['source'] = 'hook';

  switch (event.type) {
    case 'agent.activity_changed':
      agentId = event.payload.agentId;
      if (!event.payload.hookName) {
        // The per-tool heartbeat (sync-sources/hooks/heartbeat-hook) fires on
        // PostToolUse but its ingestion path does not thread hookName through.
        // A tool-carrying beat IS a PostToolUse — synthesize the name so the
        // hook bus LEDs and telemetry channels light from real events instead
        // of everything collapsing into an unnamed lifecycle bucket.
        if (event.payload.currentTool) {
          tool = event.payload.currentTool;
          hookName = 'PostToolUse';
          break;
        }
        source = 'lifecycle';
        tool = event.payload.activity;
        hookName = 'Lifecycle';
        break;
      }
      tool = event.payload.currentTool ?? event.payload.hookName;
      hookName = event.payload.hookName;
      break;
    case 'agent.hook_fired':
      agentId = event.payload.agentId;
      tool = event.payload.tool ?? event.payload.hookName;
      hookName = event.payload.hookName;
      break;
    case 'agent.permission_requested':
      agentId = event.payload.agentId;
      tool = event.payload.toolName;
      hookName = 'PermissionRequest';
      break;
    case 'agent.message_received':
      agentId = event.payload.agentId;
      tool = 'UserPromptSubmit';
      hookName = 'UserPromptSubmit';
      break;
    default:
      return null;
  }

  const agent = agentsById[agentId];
  return {
    sequence: event.sequence,
    source,
    agentId,
    issueId: agent?.issueId ?? null,
    tool,
    hookName,
    family: source === 'lifecycle' ? 'lifecycle' : toolToFamily(tool),
    ts: Date.parse(event.timestamp) || Date.now(),
  };
}

function withMicroState(
  current: Readonly<Record<string, ConfluenceMicroState>>,
  event: DomainEvent,
  now: number,
): Readonly<Record<string, ConfluenceMicroState>> {
  let agentId: string | undefined;
  let patch: Partial<ConfluenceMicroState> | undefined;

  switch (event.type) {
    case 'agent.thinking_started':
      agentId = event.payload.agentId;
      patch = { thinkUntil: now + MICRO_STATE_HOLD_MS };
      break;
    case 'agent.thinking_stopped':
      agentId = event.payload.agentId;
      patch = { thinkUntil: 0 };
      break;
    case 'agent.waiting_started':
      agentId = event.payload.agentId;
      patch = { waitUntil: now + MICRO_STATE_HOLD_MS };
      break;
    case 'agent.waiting_cleared':
      agentId = event.payload.agentId;
      patch = { waitUntil: 0 };
      break;
    case 'agent.context_saturation_changed':
      agentId = event.payload.agentId;
      patch = { compactT: event.payload.contextSaturatedAt ? COMPACT_DURATION_SECONDS : 0 };
      break;
    case 'agent.activity_changed':
      agentId = event.payload.agentId;
      if (event.payload.hookName === 'PreCompact' || event.payload.currentTool === 'compact') {
        patch = { compactT: COMPACT_DURATION_SECONDS };
      } else if (event.payload.hookName === 'PostCompact') {
        patch = { compactT: 0 };
      }
      break;
    case 'cost.event_recorded':
      agentId = event.payload.agentId;
      patch = { spend: (current[agentId]?.spend ?? 0) + event.payload.cost };
      break;
    default:
      break;
  }

  if (!agentId || !patch) return current;
  const previous = current[agentId] ?? { thinkUntil: 0, waitUntil: 0, compactT: 0, spend: 0 };
  return { ...current, [agentId]: { ...previous, ...patch } };
}

function appendEvents(
  current: ConfluenceHookStream,
  events: readonly DomainEvent[],
  agentsById: Record<string, AgentSnapshot>,
  now: number,
): ConfluenceHookStream {
  const cutoff = now - EVENT_WINDOW_MS;
  const incoming = events
    .map((event) => telemetryEntry(event, agentsById))
    .filter((entry): entry is HookStreamEntry => entry !== null);
  const entries = [...current.entries.filter((entry) => entry.ts >= cutoff), ...incoming]
    .slice(-HOOK_STREAM_LIMIT);
  const eventTimes = entries.map((entry) => entry.ts).filter((ts) => ts >= cutoff);
  const specRates = { ...current.specRates };
  for (const entry of incoming) specRates[entry.family] = Math.min(1, specRates[entry.family] + RATE_BUMP);
  const eventsPerMin = eventTimes.length;
  const eventsPerSec = eventTimes.filter((ts) => ts >= now - 1_000).length;
  const targetEnergy = Math.min(1, eventsPerMin / 110);
  let microStatesByAgentId = current.microStatesByAgentId;
  let costEvents = current.costEvents.filter((event) => event.ts >= cutoff);
  for (const event of events) {
    microStatesByAgentId = withMicroState(microStatesByAgentId, event, now);
    if (event.type === 'cost.event_recorded') {
      costEvents = [...costEvents, {
        agentId: event.payload.agentId,
        issueId: event.payload.issueId,
        cost: event.payload.cost,
        ts: Date.parse(event.timestamp) || now,
      }].slice(-HOOK_STREAM_LIMIT);
    }
  }

  return {
    entries,
    eventTimes,
    eventsPerMin,
    eventsPerSec,
    specRates,
    energy: current.energy + (targetEnergy - current.energy) * 0.15,
    microStatesByAgentId,
    costEvents,
  };
}

function decayStream(current: ConfluenceHookStream, now: number): ConfluenceHookStream {
  const cutoff = now - EVENT_WINDOW_MS;
  const entries = current.entries.filter((entry) => entry.ts >= cutoff);
  const eventTimes = entries.map((entry) => entry.ts);
  const eventsPerMin = eventTimes.length;
  const targetEnergy = Math.min(1, eventsPerMin / 110);
  const specRates = emptySpecRates();
  for (const key of HOOK_KEYS) specRates[key] = current.specRates[key] * 0.5;
  return {
    ...current,
    entries,
    eventTimes,
    eventsPerMin,
    eventsPerSec: eventTimes.filter((ts) => ts >= now - 1_000).length,
    specRates,
    energy: current.energy + (targetEnergy - current.energy) * 0.15,
    costEvents: current.costEvents.filter((event) => event.ts >= cutoff),
  };
}

export function useHookStream(): ConfluenceHookStream {
  const [stream, setStream] = useState<ConfluenceHookStream>(emptyHookStream);

  useEffect(() => {
    const unsubscribe = subscribeDashboardDomainEvents((events) => {
      const now = Date.now();
      const agentsById = useDashboardStore.getState().agentsById;
      setStream((current) => appendEvents(current, events, agentsById, now));
    });
    const decayTimer = setInterval(() => {
      setStream((current) => decayStream(current, Date.now()));
    }, RATE_DECAY_MS);
    return () => {
      unsubscribe();
      clearInterval(decayTimer);
    };
  }, []);

  return stream;
}

async function fetchParked(): Promise<ParkedResponse> {
  const response = await fetch('/api/parked');
  if (!response.ok) throw new Error('Failed to fetch parked population');
  return response.json() as Promise<ParkedResponse>;
}

/**
 * The parked population for the God View cast (PAN-3490). Fetched once on
 * mount; refreshed only by sweeper observation events, including sweep.scan
 * when the population changes. No polling interval — the honesty contract
 * forbids fabricated motion, and a timer refetch would animate nothing that
 * happened.
 */
export function useParked(): ParkedResponse | null {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = subscribeDashboardDomainEvents((events) => {
      if (events.some((event) => event.type === 'sweep.scan')) {
        void queryClient.invalidateQueries({ queryKey: ['parked-population'] });
      }
    });
    return unsubscribe;
  }, [queryClient]);
  const { data } = useQuery({
    queryKey: ['parked-population'],
    queryFn: fetchParked,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    retry: 1,
  });
  return data ?? null;
}

/** Index parked rows by issue, keeping the row for the issue's PRIMARY (most severe) orbit. */
function parkedPrimaryByIssue(parked: ParkedResponse | null): Map<string, ParkedRowView> {
  const map = new Map<string, ParkedRowView>();
  if (!parked) return map;
  for (const [issueId, orbit] of Object.entries(parked.summary.primaryByIssue)) {
    const row = parked.rows.find((candidate) => candidate.issueId === issueId && candidate.orbit === orbit)
      ?? parked.rows.find((candidate) => candidate.issueId === issueId);
    if (row) map.set(issueId, row);
  }
  return map;
}

/** A parked issue with no live agent gets a synthesized Doldrums orb — the graveyard is real cast. */
function parkedOnlyOrb(row: ParkedRowView, issue: IssueRecord | undefined, now: number): ConfluenceOrb {
  const parkedMs = Math.max(0, now - Date.parse(row.parkedAt));
  const parkedMin = Math.floor(parkedMs / 60_000);
  return {
    id: row.issueId,
    project: issueProject(row.issueId),
    role: 'work',
    stage: 'WORK',
    title: issue?.title ?? row.issueId,
    heat: 0.04,
    staleMin: parkedMin,
    state: 'stale',
    convoy: null,
    yieldReason: null,
    yieldedByScheduler: false,
    warn: null,
    broken: false,
    model: null,
    harness: null,
    labels: issue?.labels ?? [],
    glyph: null,
    lastActivity: null,
    idleMin: parkedMin,
    waitUntil: 0,
    thinkUntil: 0,
    compactT: 0,
    spend: 0,
    mergeStatus: null,
    parkedOrbit: row.orbit,
    parkedMin,
    orbitReason: row.parkReason,
  };
}

export function useConfluenceOrbs(
  microStatesByAgentId: Readonly<Record<string, ConfluenceMicroState>> = EMPTY_MICRO_STATES,
): readonly ConfluenceOrb[] {
  const agentsById = useDashboardStore((state) => state.agentsById);
  const agentRuntimeById = useDashboardStore((state) => state.agentRuntimeById);
  const issuesRaw = useDashboardStore((state) => state.issuesRaw);
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const parked = useParked();
  const agents = useMemo(() => Object.values(agentsById), [agentsById]);
  const issueIds = useMemo(
    () => Array.from(new Set(agents.map((agent) => agent.issueId).filter(Boolean))).sort(),
    [agents],
  );
  const workspaceHealth = useWorkspaceStackHealthQuery(issueIds, { staleTime: 30_000 }).data?.workspaces
    ?? EMPTY_WORKSPACE_HEALTH;
  const cache = useRef(new Map<string, { signature: string; orb: ConfluenceOrb }>());

  return useMemo(() => {
    const issues = issuesRaw as IssueRecord[];
    const issuesById = new Map(issues.map((issue) => [issueKey(issue), issue]));
    const parkedByIssue = parkedPrimaryByIssue(parked);
    const agentsByIssue = new Map<string, AgentSnapshot[]>();
    for (const agent of agents) {
      const list = agentsByIssue.get(agent.issueId) ?? [];
      list.push(agent);
      agentsByIssue.set(agent.issueId, list);
    }

    const next: ConfluenceOrb[] = [];
    const liveIds = new Set<string>();
    const now = Date.now();
    for (const [id, issueAgents] of agentsByIssue) {
      const issue = issuesById.get(id.toUpperCase());
      const review = reviewStatusByIssueId[id];
      // Membership: an orb exists only for issues the pipeline is actually
      // touching — a live/paused agent or an in-flight merge. Closed-out issues
      // never render, no matter what agent residue remains in the registry.
      const knownOpenIssue = issue !== undefined && !closedIssueState(issue);
      const hasLiveAgent = issueAgents.some((agent) =>
        ALWAYS_LIVE_STATUSES.has(String(agent.status))
        || ((CONDITIONAL_LIVE_STATUSES.has(String(agent.status)) || agent.paused === true) && knownOpenIssue));
      const mergeActive = ACTIVE_MERGE_STATUSES.has(String(review?.mergeStatus ?? issue?.mergeStatus ?? ''));
      if (!hasLiveAgent && !mergeActive) continue;
      if (closedIssueState(issue)) continue;
      liveIds.add(id);
      const stage = orbStage(issueAgents, issue, review);
      const primary = primaryAgent(issueAgents, stage);
      const lastActivity = latestActivity(issueAgents, agentRuntimeById);
      const lastActivityMs = lastActivity ? Date.parse(lastActivity) : Number.NaN;
      const idleMin = Number.isFinite(lastActivityMs) ? Math.max(0, (now - lastActivityMs) / 60_000) : 0;
      const yieldedByScheduler = issueAgents.some((agent) =>
        (agent as AgentSnapshot & { yieldedByScheduler?: boolean }).yieldedByScheduler === true ||
        agent.pausedReason?.toLowerCase().includes('yield') === true,
      );
      const mergeStatus = review?.mergeStatus ?? issue?.mergeStatus;
      const micro = aggregateMicroState(issueAgents, microStatesByAgentId);
      const broken = workspaceHealth[id.toUpperCase()]?.stackHealth?.healthy === false
        || (issue?.stackHealth as { healthy?: boolean } | undefined)?.healthy === false;
      const parkedRow = parkedByIssue.get(id.toUpperCase()) ?? null;
      const parkedMin = parkedRow ? Math.max(0, Math.floor((now - Date.parse(parkedRow.parkedAt)) / 60_000)) : null;
      const orb: ConfluenceOrb = {
        id,
        project: issueProject(id),
        role: stage === 'VERIFY' || stage === 'MERGE' ? 'ship' : (primary.role ?? 'work'),
        stage,
        title: issue?.title ?? id,
        heat: Math.min(1, 0.25 + issueAgents.filter((agent) => activeStatus(agent.status)).length * 0.15),
        staleMin: idleMin,
        state: classifyOrb({
          paused: issueAgents.some((agent) => agent.paused === true),
          yieldedByScheduler,
          mergeStatus,
          lastActivity,
        }, now),
        convoy: convoyMembers(issueAgents),
        yieldReason: issueAgents.find((agent) => agent.pausedReason)?.pausedReason ?? null,
        yieldedByScheduler,
        warn: primary.status === 'error' || primary.troubled ? (primary.lastFailureReason ?? primary.status) : null,
        broken,
        model: primary.model ?? null,
        harness: primary.runtime ?? null,
        labels: issue?.labels ?? [],
        glyph: modelGlyph(primary.model),
        lastActivity,
        idleMin,
        waitUntil: micro.waitUntil,
        thinkUntil: micro.thinkUntil,
        compactT: micro.compactT,
        spend: micro.spend,
        mergeStatus: typeof mergeStatus === 'string' ? mergeStatus : null,
        parkedOrbit: parkedRow?.orbit ?? null,
        parkedMin,
        orbitReason: parkedRow?.parkReason ?? null,
      };
      const signature = orbSignature(orb);
      const previous = cache.current.get(id);
      if (previous?.signature === signature) {
        next.push(previous.orb);
      } else {
        cache.current.set(id, { signature, orb });
        next.push(orb);
      }
    }
    for (const id of cache.current.keys()) {
      if (!liveIds.has(id)) cache.current.delete(id);
    }
    // Parked-but-invisible cast: an issue can be parked with NO live agent and
    // no active merge (a stuck flag on a dead work agent, an exhausted merge).
    // Those never passed membership above — synthesize their Doldrums orbs so
    // the whole parked population is real cast, not just the live-agent slice.
    for (const [issueId, row] of parkedByIssue) {
      if (liveIds.has(issueId)) continue;
      const issue = issuesById.get(issueId);
      if (closedIssueState(issue)) continue;
      const orb = parkedOnlyOrb(row, issue, now);
      const signature = orbSignature(orb);
      const previous = cache.current.get(issueId);
      if (previous?.signature === signature) {
        next.push(previous.orb);
      } else {
        cache.current.set(issueId, { signature, orb });
        next.push(orb);
      }
      liveIds.add(issueId);
    }
    // Doldrums emissaries: the OLDEST stale orbs represent the population
    // (a graveyard reads oldest-first), capped so a large census never
    // becomes a label wall. The Doldrums label counts the true total.
    const staleOrbs = next.filter((orb) => orb.state === 'stale')
      .sort((a, b) => b.staleMin - a.staleMin)
      .slice(0, STALE_ORB_LIMIT);
    const keepStale = new Set(staleOrbs.map((orb) => orb.id));
    return next
      .filter((orb) => orb.state !== 'stale' || keepStale.has(orb.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [agents, issuesRaw, microStatesByAgentId, reviewStatusByIssueId, workspaceHealth, parked, agentRuntimeById]);
}

type CostSummaryResponse = { today?: { totalTokens?: number } };
type ConversationSummary = { name?: string; status?: string; sessionAlive?: boolean };

async function fetchCostSummary(): Promise<CostSummaryResponse> {
  const response = await fetch('/api/costs/summary');
  if (!response.ok) throw new Error('Failed to fetch cost summary');
  return response.json() as Promise<CostSummaryResponse>;
}

async function fetchConversations(): Promise<ConversationSummary[]> {
  const response = await fetch('/api/conversations');
  if (!response.ok) throw new Error('Failed to fetch conversations');
  return response.json() as Promise<ConversationSummary[]>;
}

interface VelocityResponse {
  transitionsPerHour?: number;
  byStage?: Record<string, number>;
}

async function fetchVelocity(): Promise<VelocityResponse> {
  const response = await fetch('/api/velocity');
  if (!response.ok) throw new Error('Failed to fetch pipeline velocity');
  return response.json() as Promise<VelocityResponse>;
}

function isMergeActivityToday(entry: unknown, midnight: number): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as Record<string, unknown>;
  const timestamp = Date.parse(String(record['timestamp'] ?? ''));
  if (!Number.isFinite(timestamp) || timestamp < midnight) return false;
  const type = String(record['type'] ?? record['source'] ?? '').toLowerCase();
  const message = String(record['message'] ?? '').toLowerCase();
  return type.includes('merge') && (message.includes('merged') || type.includes('complete'));
}

export function useConfluenceMeta(
  orbs: readonly ConfluenceOrb[],
  hookStream: ConfluenceHookStream,
): ConfluenceMeta {
  const agentsById = useDashboardStore((state) => state.agentsById);
  const agentRuntimeById = useDashboardStore((state) => state.agentRuntimeById);
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const recentActivity = useDashboardStore((state) => state.recentActivity);
  const system = useGodViewStore((state) => state.systemHealth);
  const { data: costSummary } = useQuery({
    queryKey: ['agents-fleet-cost-summary'],
    queryFn: fetchCostSummary,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const parked = useParked();
  const { data: velocity } = useQuery({
    queryKey: ['pipeline-velocity'],
    queryFn: fetchVelocity,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  return useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const roleCounts: Record<string, number> = {};
    for (const agent of Object.values(agentsById)) {
      const role = agent.role ?? 'work';
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
    const liveConversations = conversations?.filter((conversation) =>
      conversation.name?.startsWith('conv-') &&
      conversation.sessionAlive !== false &&
      conversation.status !== 'ended',
    ).length ?? null;
    const costEvents = hookStream.costEvents.filter((event) => event.ts >= Date.now() - EVENT_WINDOW_MS);

    return {
      mergesToday: recentActivity.filter((entry) => isMergeActivityToday(entry, midnight)).length,
      tokensToday: costSummary?.today?.totalTokens ?? null,
      costPerMin: costEvents.length > 0
        ? costEvents.reduce((total, event) => total + event.cost, 0)
        : null,
      mergeQ: Object.values(reviewStatusByIssueId).filter((review) =>
        review.mergeStatus === 'queued' || review.mergeStatus === 'merging',
      ).length,
      conversations: liveConversations,
      staleTotal: orbs.filter((orb) => orb.state === 'stale').length,
      oldestIdle: orbs.reduce((oldest, orb) => Math.max(oldest, orb.idleMin), 0),
      beads: null,
      system,
      // The operator's definition: an agent counts as active only while it is
      // actually producing (activity in the last 15 minutes, event-driven via
      // agentRuntimeById) — a 'running' registry row that has sat idle for
      // hours is not live work.
      active: Object.values(agentsById).filter((agent) => recentlyActive(agent, agentRuntimeById[agent.id], now.getTime())).length,
      total: Object.keys(agentsById).length,
      roleCounts,
      parkedTotal: parked?.summary.total ?? null,
      parkedByOrbit: parked?.summary.byOrbit ?? null,
      velocity: velocity?.transitionsPerHour != null
        ? { transitionsPerHour: velocity.transitionsPerHour, byStage: velocity.byStage ?? {} }
        : null,
    };
  }, [agentsById, agentRuntimeById, conversations, costSummary, hookStream.costEvents, orbs, recentActivity, reviewStatusByIssueId, system, parked, velocity]);
}

export function useConfluenceData(): ConfluenceData {
  const hookStream = useHookStream();
  const orbs = useConfluenceOrbs(hookStream.microStatesByAgentId);
  const meta = useConfluenceMeta(orbs, hookStream);
  return { orbs, hookStream, meta };
}
