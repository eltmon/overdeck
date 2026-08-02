import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentSnapshot, DomainEvent, ReviewStatusSnapshot } from '@overdeck/contracts';
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
}

export interface HookStreamEntry {
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

function latestActivity(agents: readonly AgentSnapshot[]): string | null {
  let latest: string | null = null;
  for (const agent of agents) {
    const candidate = agent.lastActivity ?? agent.startedAt;
    if (candidate && (!latest || candidate > latest)) latest = candidate;
  }
  return latest;
}

function activeStatus(status: AgentSnapshot['status']): boolean {
  return status === 'running' || status === 'starting';
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
  if (
    mergeStatus === 'queued' ||
    mergeStatus === 'merging' ||
    mergeStatus === 'verifying' ||
    mergedPendingCloseout(issue, review)
  ) return 'VERIFY';
  if (agents.some((agent) => agent.role === 'test')) return 'TEST';
  if (agents.some((agent) => agent.role === 'review' || agent.id.includes('-review'))) return 'REVIEW';
  if (agents.some((agent) => agent.role === 'plan')) return 'PLAN';
  return 'WORK';
}

function primaryAgent(agents: readonly AgentSnapshot[], stage: Stage): AgentSnapshot {
  const role = stage === 'PLAN' ? 'plan'
    : stage === 'REVIEW' ? 'review'
      : stage === 'TEST' ? 'test'
        : stage === 'VERIFY' ? 'ship'
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
    key === 'staleMin' || key === 'idleMin' ? undefined : value,
  );
}

function telemetryEntry(event: DomainEvent, agentsById: Record<string, AgentSnapshot>): HookStreamEntry | null {
  let agentId: string | undefined;
  let tool: string | undefined;
  let hookName: string | undefined;

  switch (event.type) {
    case 'agent.activity_changed':
      agentId = event.payload.agentId;
      tool = event.payload.currentTool ?? event.payload.hookName ?? event.payload.activity;
      hookName = event.payload.hookName ?? 'PostToolUse';
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
    case 'agent.waiting_started':
      agentId = event.payload.agentId;
      tool = 'Notification';
      hookName = 'Notification';
      break;
    default:
      return null;
  }

  const agent = agentsById[agentId];
  return {
    agentId,
    issueId: agent?.issueId ?? null,
    tool,
    hookName,
    family: toolToFamily(tool),
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

export function useConfluenceOrbs(
  microStatesByAgentId: Readonly<Record<string, ConfluenceMicroState>> = EMPTY_MICRO_STATES,
): readonly ConfluenceOrb[] {
  const agentsById = useDashboardStore((state) => state.agentsById);
  const issuesRaw = useDashboardStore((state) => state.issuesRaw);
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
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
      liveIds.add(id);
      const issue = issuesById.get(id.toUpperCase());
      const review = reviewStatusByIssueId[id];
      const stage = orbStage(issueAgents, issue, review);
      const primary = primaryAgent(issueAgents, stage);
      const lastActivity = latestActivity(issueAgents);
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
      const orb: ConfluenceOrb = {
        id,
        project: issueProject(id),
        role: stage === 'VERIFY' ? 'ship' : (primary.role ?? 'work'),
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
        warn: primary.status === 'error' || primary.troubled ? (primary.lastFailureReason ?? primary.status) : null,
        broken,
        model: primary.model ?? null,
        harness: null,
        labels: issue?.labels ?? [],
        glyph: modelGlyph(primary.model),
        lastActivity,
        idleMin,
        waitUntil: micro.waitUntil,
        thinkUntil: micro.thinkUntil,
        compactT: micro.compactT,
        spend: micro.spend,
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
    return next.sort((a, b) => a.id.localeCompare(b.id));
  }, [agents, issuesRaw, microStatesByAgentId, reviewStatusByIssueId, workspaceHealth]);
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
      active: Object.values(agentsById).filter((agent) => activeStatus(agent.status)).length,
      total: Object.keys(agentsById).length,
      roleCounts,
    };
  }, [agentsById, conversations, costSummary, hookStream.costEvents, orbs, recentActivity, reviewStatusByIssueId, system]);
}

export function useConfluenceData(): ConfluenceData {
  const hookStream = useHookStream();
  const orbs = useConfluenceOrbs(hookStream.microStatesByAgentId);
  const meta = useConfluenceMeta(orbs, hookStream);
  return { orbs, hookStream, meta };
}
