import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentState, Role } from '../../../lib/agents/agent-state.js';
import { getAgentStateSync, isRole } from '../../../lib/agents/agent-state.js';
import { getSessionId } from '../../../lib/agents/activity.js';
import { getAgentRuntimeStateSync } from '../../../lib/agents/runtime-state.js';
import { hasRetainedTranscriptsMarker } from '../../../lib/agents/state-dir-removal.js';
import { listAllAgentsSync } from '../../../lib/overdeck/agents.js';
import {
  listAgentRuntimeEventEvidenceSync,
  type AgentRuntimeEventEvidence,
} from '../../../lib/overdeck/event-reads.js';
import {
  backfillAgentPlaneRecord,
  flushAgentPlaneWrites,
  readAgentPlaneRecordSync,
  type AgentPlaneSeed,
  type AgentPlaneSessionEntry,
} from '../../../lib/pan-dir/agents.js';
import { claudeSessionTranscriptExists, getOverdeckHome } from '../../../lib/paths.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { readSessionIdHistorySync } from '../../../lib/session-history.js';

const RUNTIME_NAMES = new Set<RuntimeName>([
  'claude-code',
  'ohmypi',
  'codex',
  'acp',
  'kimi-code',
]);

type DbAgent = ReturnType<typeof listAllAgentsSync>[number];

export type AgentPlaneBackfillStatus =
  | 'reconstructed'
  | 'recovered-partial'
  | 'skipped-live'
  | 'skipped';

export interface AgentPlaneBackfillResult {
  agentId: string;
  issueId?: string;
  status: AgentPlaneBackfillStatus;
  sessions: string[];
  reason?: string;
}

export interface AgentPlaneBackfillDeps {
  listLocalAgentIds: () => string[];
  hasLocalState: (agentId: string) => boolean;
  hasRetainedMarker: (agentId: string) => Promise<boolean>;
  readAgentState: (agentId: string) => AgentState | null;
  listDbAgents: () => DbAgent[];
  listEventEvidence: () => AgentRuntimeEventEvidence[];
  readCurrentSessionId: (agentId: string) => string | null;
  readSessionHistory: (agentId: string) => string[];
  readRuntimeSessionId: (agentId: string) => string | null;
  transcriptExists: (workspace: string, sessionId: string) => boolean;
  resolveProject: typeof resolveProjectFromIssueSync;
  readPlaneRecord: typeof readAgentPlaneRecordSync;
  writePlaneRecord: typeof backfillAgentPlaneRecord;
  flushPlaneWrites: typeof flushAgentPlaneWrites;
  log: (message: string) => void;
}

function localAgentIds(): string[] {
  const agentsDir = join(getOverdeckHome(), 'agents');
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function defaultDeps(): AgentPlaneBackfillDeps {
  const agentsDir = join(getOverdeckHome(), 'agents');
  return {
    listLocalAgentIds: localAgentIds,
    hasLocalState: (agentId) => existsSync(join(agentsDir, agentId, 'state.json')),
    hasRetainedMarker: (agentId) => hasRetainedTranscriptsMarker(join(agentsDir, agentId)),
    readAgentState: getAgentStateSync,
    listDbAgents: listAllAgentsSync,
    listEventEvidence: listAgentRuntimeEventEvidenceSync,
    readCurrentSessionId: getSessionId,
    readSessionHistory: readSessionIdHistorySync,
    readRuntimeSessionId: (agentId) => getAgentRuntimeStateSync(agentId)?.claudeSessionId ?? null,
    transcriptExists: claudeSessionTranscriptExists,
    resolveProject: resolveProjectFromIssueSync,
    readPlaneRecord: readAgentPlaneRecordSync,
    writePlaneRecord: backfillAgentPlaneRecord,
    flushPlaneWrites: flushAgentPlaneWrites,
    log: (message) => console.log(message),
  };
}

function runtimeName(value: unknown): RuntimeName | undefined {
  if (value === 'pi') return 'ohmypi';
  return typeof value === 'string' && RUNTIME_NAMES.has(value as RuntimeName)
    ? value as RuntimeName
    : undefined;
}

function usableString(...values: unknown[]): string | undefined {
  return values.find((value): value is string =>
    typeof value === 'string' && Boolean(value.trim()))?.trim();
}

function seedForAgent(
  agentId: string,
  state: AgentState | null,
  db: DbAgent | undefined,
  event: AgentRuntimeEventEvidence | undefined,
): AgentPlaneSeed | null {
  const issueId = usableString(state?.issueId, db?.issueId, event?.issueId);
  const workspace = usableString(state?.workspace, db?.workspace, event?.workspace);
  const roleValue = state?.role ?? db?.role ?? event?.role;
  if (!issueId || !workspace || !isRole(roleValue)) return null;
  return {
    id: agentId,
    issueId,
    role: roleValue as Role,
    workspace,
    harness: runtimeName(state?.harness ?? db?.harness),
    model: usableString(state?.model, db?.model, event?.model),
    branch: usableString(state?.branch, db?.branch, event?.branch),
    startedAt: usableString(state?.startedAt, db?.startedAt, event?.startedAt),
  };
}

function appendSession(
  sessions: AgentPlaneSessionEntry[],
  seen: Set<string>,
  id: string | null | undefined,
  startedAt: string,
  reason: AgentPlaneSessionEntry['reason'],
): void {
  const normalized = id?.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  sessions.push({ id: normalized, startedAt, reason });
}

function sessionsForAgent(
  seed: AgentPlaneSeed,
  state: AgentState | null,
  db: DbAgent | undefined,
  event: AgentRuntimeEventEvidence | undefined,
  recovered: boolean,
  deps: AgentPlaneBackfillDeps,
): AgentPlaneSessionEntry[] {
  const sessions: AgentPlaneSessionEntry[] = [];
  const seen = new Set<string>();
  const startedAt = seed.startedAt ?? new Date().toISOString();
  const localReason = recovered ? 'recovered' : 'spawn';
  const localCandidates = [
    deps.readCurrentSessionId(seed.id),
    ...deps.readSessionHistory(seed.id),
    deps.readRuntimeSessionId(seed.id),
    state?.sessionId,
    db?.sessionId,
  ];
  for (const sessionId of localCandidates) {
    const valid = seed.harness && seed.harness !== 'claude-code'
      ? true
      : Boolean(sessionId && deps.transcriptExists(seed.workspace, sessionId));
    if (valid) appendSession(sessions, seen, sessionId, startedAt, localReason);
  }
  for (const session of event?.sessions ?? []) {
    if (deps.transcriptExists(seed.workspace, session.id)) {
      appendSession(sessions, seen, session.id, session.startedAt, 'recovered');
    }
  }
  return sessions;
}

function isLiveStatus(state: AgentState | null, db: DbAgent | undefined): boolean {
  const status = state?.status ?? db?.status;
  return status === 'running' || status === 'starting';
}

export async function backfillAgentRuntimePlane(
  options: { projectKey?: string; dryRun?: boolean } = {},
  deps: AgentPlaneBackfillDeps = defaultDeps(),
): Promise<AgentPlaneBackfillResult[]> {
  const localIds = new Set(deps.listLocalAgentIds());
  const dbById = new Map(deps.listDbAgents().map((agent) => [agent.id, agent]));
  const eventById = new Map(deps.listEventEvidence().map((event) => [event.agentId, event]));
  const agentIds = new Set([...localIds, ...dbById.keys(), ...eventById.keys()]);
  const results: AgentPlaneBackfillResult[] = [];
  const flushTargets = new Map<string, { issueId: string; agentId: string }>();

  for (const agentId of [...agentIds].sort()) {
    const state = deps.readAgentState(agentId);
    const db = dbById.get(agentId);
    const event = eventById.get(agentId);
    const seed = seedForAgent(agentId, state, db, event);
    if (!seed) {
      results.push({
        agentId,
        status: 'skipped',
        sessions: [],
        reason: 'identity, role, or workspace metadata is incomplete',
      });
      continue;
    }
    const project = deps.resolveProject(seed.issueId);
    if (!project) {
      results.push({
        agentId,
        issueId: seed.issueId,
        status: 'skipped',
        sessions: [],
        reason: `no configured project resolves ${seed.issueId}`,
      });
      continue;
    }
    if (options.projectKey && project.projectKey !== options.projectKey) continue;

    const hasLocalState = deps.hasLocalState(agentId);
    const retained = await deps.hasRetainedMarker(agentId);
    const recovered = !hasLocalState || (retained && !deps.readCurrentSessionId(agentId));
    const existing = deps.readPlaneRecord(seed.issueId, agentId);
    if (isLiveStatus(state, db) && existing) {
      if (!options.dryRun) {
        flushTargets.set(project.projectKey, { issueId: seed.issueId, agentId });
      }
      results.push({
        agentId,
        issueId: seed.issueId,
        status: 'skipped-live',
        sessions: existing.sessions.map((session) => session.id),
      });
      continue;
    }

    const sessions = sessionsForAgent(seed, state, db, event, recovered, deps);
    if (options.dryRun) {
      results.push({
        agentId,
        issueId: seed.issueId,
        status: recovered ? 'recovered-partial' : 'reconstructed',
        sessions: sessions.map((session) => session.id),
        reason: 'dry run; durable record was not written',
      });
      continue;
    }
    try {
      const written = await deps.writePlaneRecord(
        seed,
        sessions,
        recovered,
        { deferCommit: true },
      );
      if (written || existing) {
        flushTargets.set(project.projectKey, { issueId: seed.issueId, agentId });
      }
      results.push({
        agentId,
        issueId: seed.issueId,
        status: !written && !existing
          ? 'skipped'
          : recovered ? 'recovered-partial' : 'reconstructed',
        sessions: (!written && existing ? existing.sessions : sessions)
          .map((session) => session.id),
        ...(!written ? {
          reason: existing
            ? 'existing durable record already contained equal or stronger history'
            : 'durable agent plane is unavailable for this project',
        } : {}),
      });
    } catch (error) {
      results.push({
        agentId,
        issueId: seed.issueId,
        status: 'skipped',
        sessions: [],
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const [projectKey, target] of flushTargets) {
    const flush = await deps.flushPlaneWrites(target.issueId, target.agentId);
    if (!flush || flush.errored || flush.pushed !== true) {
      throw new Error(
        `Agent-plane backfill push failed for ${projectKey}: ${flush?.reason ?? 'no confirmed state-branch push'}`,
      );
    }
  }

  for (const result of results) {
    deps.log(
      `${result.agentId}: ${result.status}`
      + `${result.sessions.length > 0 ? ` (sessions: ${result.sessions.join(', ')})` : ''}`
      + `${result.reason ? ` — ${result.reason}` : ''}`,
    );
  }
  return results;
}
