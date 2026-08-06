/** Canonical read/write door for durable per-agent runtime metadata. */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';

import type { Role } from '../agents/role.js';

/**
 * Structural view of the agent runtime state this door needs. Declared here
 * (not imported from agents/agent-state.ts) so this module stays a leaf in the
 * module graph — agent-state.ts calls back into this door, and an import edge
 * in both directions is a lint:circular violation. Structural typing accepts
 * AgentState at call sites with no casts; if the canonical Role union grows,
 * assignability fails loudly here.
 */
export interface AgentPlaneAgentState {
  id: string;
  issueId: string;
  role: Role;
  workspace: string;
  harness?: RuntimeName;
  model?: string;
  branch?: string;
  startedAt?: string;
  sessionId?: string;
}
import { getOverdeckHome } from '../paths.js';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';
import type { RuntimeName } from '../runtimes/types.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import {
  flushAutoCommits,
  pushPendingStateCommits,
  queueAutoCommit,
  reconcileStatePlaneDrift,
  type FlushResult,
} from './auto-commit.js';
import { withRecordFsLock } from './fs-lock.js';

export const AGENT_PLANE_DIRNAME = 'agents';
export const AGENT_PLANE_VERSION = 1 as const;

export type AgentPlaneSessionReason = 'spawn' | 'rotation' | 'recovered';
export type AgentPlaneLifecycleEvent = 'spawned' | 'stopped' | 'tombstoned';

export interface AgentPlaneSessionEntry {
  id: string;
  startedAt: string;
  reason: AgentPlaneSessionReason;
}

export interface AgentPlaneTombstonePredicate {
  closedOutFlag: boolean;
  trackerState: string;
  liveTmux: boolean | null;
  openChangeRequest: boolean | null;
  inFlightReviewOrTest: boolean | null;
}

export interface AgentPlaneLifecycleEntry {
  at: string;
  event: AgentPlaneLifecycleEvent;
  predicate?: AgentPlaneTombstonePredicate;
  filesRemoved?: string[];
}

export interface AgentPlaneRecord {
  version: typeof AGENT_PLANE_VERSION;
  agentId: string;
  issueId: string;
  projectKey: string;
  role: Role;
  origin: {
    machineId: string;
    overdeckHome: string;
  };
  launch: {
    harness: RuntimeName | null;
    model: string | null;
    workspace: string;
    branch: string | null;
  };
  sessions: AgentPlaneSessionEntry[];
  lifecycle: AgentPlaneLifecycleEntry[];
  archiveRef: string | null;
  recovered: boolean;
}

export interface AgentPlaneSeed {
  id: string;
  issueId: string;
  role: Role;
  workspace: string;
  harness?: RuntimeName;
  model?: string;
  branch?: string;
  startedAt?: string;
}

export class AgentPlaneOwnershipError extends Error {
  constructor(agentId: string, ownerMachine: string, writerMachine: string) {
    super(
      `Refusing to write durable agent ${agentId}: origin machine is ${ownerMachine}, `
      + `current machine is ${writerMachine}.`,
    );
    this.name = 'AgentPlaneOwnershipError';
  }
}

interface AgentPlaneContext {
  projectKey: string;
  project: ProjectConfig;
  root: string;
  path: string;
}

function safeAgentId(agentId: string): string {
  const normalized = agentId.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) {
    throw new Error(`Invalid agent id for durable agent plane: ${agentId}`);
  }
  return normalized;
}

function resolveAgentPlaneContext(
  issueId: string,
  agentId: string,
  operation?: string,
): AgentPlaneContext | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    if (operation) {
      console.warn(`[pan-dir/agents] skipping ${operation} for ${agentId}: no project resolves ${issueId}`);
    }
    return null;
  }

  const project = getProjectSync(resolved.projectKey);
  if (!project) {
    if (operation) {
      console.warn(
        `[pan-dir/agents] skipping ${operation} for ${agentId}: project ${resolved.projectKey} is not configured`,
      );
    }
    return null;
  }

  const stateHome = resolveStateReadHomeSync(project);
  if (!stateHome.migrated) {
    if (operation) {
      console.warn(
        `[pan-dir/agents] skipping ${operation} for ${agentId}: project ${resolved.projectKey} `
        + 'has not migrated to overdeck-state',
      );
    }
    return null;
  }

  const normalizedAgentId = safeAgentId(agentId);
  return {
    projectKey: resolved.projectKey,
    project,
    root: stateHome.root,
    path: join(stateHome.root, AGENT_PLANE_DIRNAME, `${normalizedAgentId}.json`),
  };
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function parseAgentPlaneRecord(raw: string, path: string): AgentPlaneRecord {
  const parsed = JSON.parse(raw) as Partial<AgentPlaneRecord>;
  if (
    parsed.version !== AGENT_PLANE_VERSION
    || typeof parsed.agentId !== 'string'
    || typeof parsed.issueId !== 'string'
    || typeof parsed.projectKey !== 'string'
    || !parsed.origin
    || typeof parsed.origin.machineId !== 'string'
    || !parsed.launch
    || !Array.isArray(parsed.sessions)
    || !Array.isArray(parsed.lifecycle)
  ) {
    throw new Error(`Invalid durable agent record at ${path}`);
  }
  return parsed as AgentPlaneRecord;
}

function readAgentPlaneRecordAtPath(path: string): AgentPlaneRecord | null {
  try {
    return parseAgentPlaneRecord(readFileSync(path, 'utf-8'), path);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

export function readAgentPlaneRecordSync(
  issueId: string,
  agentId: string,
): AgentPlaneRecord | null {
  const context = resolveAgentPlaneContext(issueId, agentId);
  return context ? readAgentPlaneRecordAtPath(context.path) : null;
}

function writeAgentPlaneRecordAtomicSync(path: string, record: AgentPlaneRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  const temporaryFd = openSync(temporaryPath, 'r');
  try {
    fsyncSync(temporaryFd);
  } finally {
    closeSync(temporaryFd);
  }
  renameSync(temporaryPath, path);
  const directoryFd = openSync(dirname(path), 'r');
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
  parseAgentPlaneRecord(readFileSync(path, 'utf-8'), path);
}

function makeAgentPlaneRecord(state: AgentPlaneSeed, projectKey: string): AgentPlaneRecord {
  return {
    version: AGENT_PLANE_VERSION,
    agentId: safeAgentId(state.id),
    issueId: state.issueId.toUpperCase(),
    projectKey,
    role: state.role,
    origin: {
      machineId: hostname(),
      overdeckHome: getOverdeckHome(),
    },
    launch: {
      harness: state.harness ?? null,
      model: state.model ?? null,
      workspace: state.workspace,
      branch: state.branch ?? null,
    },
    sessions: [],
    lifecycle: [],
    archiveRef: null,
    recovered: false,
  };
}

function assertAgentPlaneOwnership(record: AgentPlaneRecord): void {
  const writerMachine = hostname();
  if (record.origin.machineId !== writerMachine) {
    throw new AgentPlaneOwnershipError(record.agentId, record.origin.machineId, writerMachine);
  }
}

async function updateAgentPlaneRecord(
  state: AgentPlaneSeed,
  operation: string,
  mutate: (record: AgentPlaneRecord) => AgentPlaneRecord | null,
  deferCommit = false,
): Promise<boolean> {
  const context = resolveAgentPlaneContext(state.issueId, state.id, operation);
  if (!context) return false;

  return withRecordFsLock(
    context.project,
    state.issueId,
    {
      writerId: `agent-plane:${safeAgentId(state.id)}`,
      recordPath: context.path,
      // Patient retries (PAN-3513 append gap, 2026-08-04): the default ~1s
      // window loses to any competing state-door writer that holds the
      // per-issue lock through its git commit+push (several seconds). These
      // plane writes are durability-critical fire-and-forget appends with no
      // latency requirement — a dropped write is a permanently lost session
      // pointer (observed: 12 real sessions, 1 on the plane; 12 dropped
      // appends in one log window). Wait out the writer instead.
      retryDelaysMs: [250, 500, 1000, 2000, 4000, 8000, 8000],
    },
    async () => {
      const existing = readAgentPlaneRecordAtPath(context.path);
      if (existing) {
        assertAgentPlaneOwnership(existing);
        if (existing.projectKey !== context.projectKey) {
          throw new Error(
            `Refusing to write durable agent ${state.id}: record belongs to project `
            + `${existing.projectKey}, resolved project is ${context.projectKey}.`,
          );
        }
      }

      const next = mutate(existing ?? makeAgentPlaneRecord(state, context.projectKey));
      if (!next) return false;
      writeAgentPlaneRecordAtomicSync(context.path, next);
      queueAutoCommit({
        projectRoot: context.project.path,
        repoRoot: context.root,
        paths: [context.path],
        subject: `chore(agents): update ${safeAgentId(state.id)} runtime record`,
        defer: deferCommit,
      });
      return true;
    },
  );
}

function appendSession(
  sessions: AgentPlaneSessionEntry[],
  entry: AgentPlaneSessionEntry | undefined,
): AgentPlaneSessionEntry[] {
  if (!entry || sessions.some((session) => session.id === entry.id)) return sessions;
  return [...sessions, entry];
}

export function recordAgentPlaneSpawn(
  state: AgentPlaneAgentState,
  sessionId = state.sessionId,
): Promise<boolean> {
  const at = state.startedAt || new Date().toISOString();
  const session = sessionId?.trim()
    ? { id: sessionId.trim(), startedAt: at, reason: 'spawn' as const }
    : undefined;
  return updateAgentPlaneRecord(state, 'spawn record', (current) => ({
    ...current,
    issueId: state.issueId.toUpperCase(),
    role: state.role,
    launch: {
      harness: state.harness ?? null,
      model: state.model ?? null,
      workspace: state.workspace,
      branch: state.branch ?? null,
    },
    sessions: appendSession(current.sessions, session),
    lifecycle: [...current.lifecycle, { at, event: 'spawned' }],
  }));
}

export function appendAgentPlaneSession(
  state: AgentPlaneAgentState,
  entry: AgentPlaneSessionEntry,
): Promise<boolean> {
  const normalizedId = entry.id.trim();
  if (!normalizedId) return Promise.resolve(false);
  return updateAgentPlaneRecord(state, 'session append', (current) => {
    if (current.sessions.some((session) => session.id === normalizedId)) return null;
    return {
      ...current,
      sessions: [...current.sessions, { ...entry, id: normalizedId }],
    };
  });
}

export function appendAgentPlaneLifecycle(
  state: AgentPlaneAgentState,
  entry: AgentPlaneLifecycleEntry,
): Promise<boolean> {
  return updateAgentPlaneRecord(state, `${entry.event} lifecycle append`, (current) => ({
    ...current,
    lifecycle: [...current.lifecycle, entry],
  }));
}

export function backfillAgentPlaneRecord(
  state: AgentPlaneSeed,
  sessions: AgentPlaneSessionEntry[],
  recovered: boolean,
  options: { deferCommit?: boolean } = {},
): Promise<boolean> {
  return updateAgentPlaneRecord(state, 'backfill', (current) => {
    const knownSessionIds = new Set(current.sessions.map((session) => session.id));
    const missingSessions = sessions.filter((entry) => {
      const id = entry.id.trim();
      if (!id || knownSessionIds.has(id)) return false;
      knownSessionIds.add(id);
      return true;
    });
    const needsSpawnedLifecycle = !current.lifecycle.some((entry) => entry.event === 'spawned');
    const nextRecovered = current.recovered || recovered;
    if (missingSessions.length === 0 && !needsSpawnedLifecycle && nextRecovered === current.recovered) {
      return null;
    }
    const spawnedAt = state.startedAt
      ?? missingSessions[0]?.startedAt
      ?? new Date().toISOString();
    return {
      ...current,
      sessions: [
        ...current.sessions,
        ...missingSessions.map((entry) => ({ ...entry, id: entry.id.trim() })),
      ],
      lifecycle: needsSpawnedLifecycle
        ? [{ at: spawnedAt, event: 'spawned' }, ...current.lifecycle]
        : current.lifecycle,
      recovered: nextRecovered,
    };
  }, options.deferCommit);
}

export async function flushAgentPlaneWrites(issueId: string, agentId: string): Promise<FlushResult | null> {
  const context = resolveAgentPlaneContext(issueId, agentId, 'flush');
  if (!context || !existsSync(context.root)) return null;

  const flushed = await Effect.runPromise(flushAutoCommits(context.project.path));
  if (flushed.errored || (flushed.committed && flushed.pushed !== true)) return flushed;

  const reconciled = await Effect.runPromise(reconcileStatePlaneDrift(context.project.path));
  if (reconciled.errored || (reconciled.committed && reconciled.pushed !== true)) {
    return reconciled;
  }
  if (flushed.committed || reconciled.committed) {
    return { committed: true, pushed: true };
  }

  const push = await Effect.runPromise(pushPendingStateCommits(context.project.path));
  return {
    committed: false,
    pushed: push?.pushed,
    reason: push?.reason ?? reconciled.reason ?? flushed.reason,
  };
}
