/**
 * Cloister Service
 *
 * Core monitoring service that watches over all running agents.
 * Named after the TARDIS's Cloister Bell - an alarm for catastrophic events.
 */

import type { AgentRuntime, HealthState } from '../runtimes/types.js';
import type { CloisterConfig } from './config.js';
import type { AgentHealth, HealthSummary } from './health.js';
import { loadCloisterConfig } from './config.js';
import {
  getAgentHealth,
  getMultipleAgentHealth,
  generateHealthSummary,
  getAgentsToPoke,
  getAgentsToKill,
  getAgentsNeedingAttention,
} from './health.js';
import {
  writeHealthEvent,
  getLatestHealthEvent,
} from '../database/health-events-db.js';
import { getDatabase, closeDatabase } from '../database/index.js';
// PAN-378: initializeEnabledSpecialists removed — per-project ephemeral specialists
// are spawned on-demand, no global initialization needed.
import { getGlobalRegistry, getRuntimeForAgent } from '../runtimes/index.js';
import { listRunningAgents, getAgentState, getAgentStateAsync, getAgentRuntimeState, saveAgentRuntimeState } from '../agents.js';
import type { Role } from '../agents.js';
import { resolveProjectFromIssue } from '../projects.js';
import { checkAllTriggers, type TriggerDetection } from './triggers.js';
import { performHandoff, type HandoffResult } from './handoff.js';
import { logHandoffEvent, createHandoffEvent } from './handoff-logger.js';
import {
  checkAgentForViolations,
  sendNudge,
  resolveViolation,
  hasExceededMaxNudges,
  clearOldViolations,
  type FPPViolation,
} from './fpp-violations.js';
import {
  checkCostLimits,
  getCostSummary,
  type CostAlert,
} from './cost-monitor.js';
import {
  checkAndRotateIfNeeded,
  type SessionRotationResult,
} from './session-rotation.js';
import {
  startDeacon,
  stopDeacon,
  isDeaconRunning,
  getDeaconStatus,
  getLastPatrolResult,
  getDeaconLogs,
  runPatrol,
  type PatrolResult,
  type DeaconLogEntry,
} from './deacon.js';
import { PANOPTICON_HOME } from '../paths.js';
import { existsSync, writeFileSync, unlinkSync, readFileSync, readdirSync, renameSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { AGENTS_DIR } from '../paths.js';
import { loadReviewStatuses, setReviewStatus } from '../review-status.js';
import { sessionExistsAsync, killSessionAsync } from '../tmux.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import { emitActivityEntry } from '../activity-logger.js';

// State file for cross-process communication
const CLOISTER_STATE_FILE = join(PANOPTICON_HOME, 'cloister.state');
const LEGACY_SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');

async function cleanupLegacySpecialistsDirectory(): Promise<void> {
  await rm(LEGACY_SPECIALISTS_DIR, { recursive: true, force: true });
}

/**
 * Pure helper: from a map of review statuses, return the issue IDs that are
 * orphaned in 'reviewing' state — i.e. reviewStatus='reviewing', no passed
 * review in history, and not currently being handled by a running specialist.
 *
 * Extracted for unit-testability; called by startup recovery in Cloister.start().
 */
export function identifyOrphanedReviewingIssues(
  statuses: Record<string, { reviewStatus: string; history?: Array<{ type: string; status: string }> }>,
  activeReviewIssues: Set<string>,
): string[] {
  const orphaned: string[] = [];
  for (const [issueId, status] of Object.entries(statuses)) {
    if (status.reviewStatus !== 'reviewing') continue;
    const hasPassedReview = status.history?.some(
      (h) => h.type === 'review' && h.status === 'passed',
    );
    if (hasPassedReview) continue;
    if (activeReviewIssues.has(issueId.toUpperCase())) continue;
    orphaned.push(issueId);
  }
  return orphaned;
}

export function parseSpecialistAgentSession(name: string): {
  projectKey: string;
  specialistType: 'review-agent' | 'test-agent' | 'merge-agent';
  issueId?: string;
} | null {
  const issueScoped = name.match(/^specialist-(.+)-([A-Z]+-\d+)-(review-agent|test-agent|merge-agent)$/);
  if (issueScoped) {
    return {
      projectKey: issueScoped[1],
      issueId: issueScoped[2],
      specialistType: issueScoped[3] as 'review-agent' | 'test-agent' | 'merge-agent',
    };
  }

  const legacy = name.match(/^specialist-(.+)-(review-agent|test-agent|merge-agent)$/);
  if (legacy) {
    return {
      projectKey: legacy[1],
      specialistType: legacy[2] as 'review-agent' | 'test-agent' | 'merge-agent',
    };
  }

  return null;
}

export type ReactiveIssueState =
  | 'todo'
  | 'open'
  | 'in_planning'
  | 'in_progress'
  | 'in_review'
  | 'testing'
  | 'shipping'
  | 'closed'
  | 'canceled';

export interface CloisterDomainEventLike {
  type: string;
  payload?: unknown;
}

const ROLE_RUN_STATES: Record<ReactiveIssueState, Role | null> = {
  todo: null,
  open: null,
  in_planning: 'plan',
  in_progress: 'work',
  in_review: 'review',
  testing: 'test',
  shipping: 'ship',
  closed: null,
  canceled: null,
};

/**
 * Map issue lifecycle state to the role that should own that state.
 */
export function stateToRole(state: string): Role | null {
  const normalized = state.toLowerCase().replace(/[ -]/g, '_') as ReactiveIssueState;
  return ROLE_RUN_STATES[normalized] ?? null;
}

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function roleFromAgentId(agentId: string, issueId: string): Role | null {
  const base = `agent-${issueId.toLowerCase()}`;
  if (agentId === base) return 'work';
  const role = agentId.slice(base.length + 1);
  return ['plan', 'review', 'test', 'ship'].includes(role) ? role as Role : null;
}

/**
 * PAN-1048 performance fix: O(1) direct state lookup instead of scanning
 * all agent directories. Roles use canonical IDs: agent-<issue-lower> for
 * work, agent-<issue-lower>-<role> for all others.
 *
 * Intentionally does NOT require tmuxActive — spawn routes write state.json
 * with status:'starting' before the tmux session attaches, so filtering on
 * tmuxActive would race-spawn a second run.
 */
async function activeRoleRunExists(issueId: string, role: Role, workspacePath?: string): Promise<boolean> {
  const issueLower = issueId.toLowerCase();

  // C1: For 'plan', also check the legacy planning-pan-X session format
  // alongside the canonical agent-pan-X-plan format. The start-planning route
  // writes to planning-pan-X while spawnRun uses agent-pan-X-plan.
  if (role === 'plan') {
    const legacyId = `planning-${issueLower}`;
    const legacyState = await getAgentStateAsync(legacyId);
    if (legacyState?.role === 'plan' && legacyState.status !== 'stopped' && legacyState.status !== 'error') {
      // S1: if stuck at 'starting' with no live tmux session, treat as not-alive
      // so the next retry can spawn a fresh run without being blocked.
      if (legacyState.status === 'starting' && !(await sessionExistsAsync(legacyId))) {
        return false;
      }
      return true;
    }
  }

  const candidateId = role === 'work'
    ? `agent-${issueLower}`
    : `agent-${issueLower}-${role}`;

  const state = await getAgentStateAsync(candidateId);
  if (!state) return false;

  const stateRole = state.role ?? roleFromAgentId(candidateId, issueId);

  // S1: treat a 'starting' state with no live tmux session as not-alive.
  if (stateRole === role && state.status === 'starting' && !(await sessionExistsAsync(candidateId))) {
    return false;
  }

  const aliveByStatus = stateRole === role && state.status !== 'stopped' && state.status !== 'error';
  if (!aliveByStatus) return false;

  // Zombie detection: an agent that finished its work but never exited keeps
  // status:'running' forever, which would block every future re-dispatch for
  // this role (the ship/test stall bug). When we know the workspace and the
  // run stamped a roleRunHead, compare it against the current workspace HEAD —
  // a HEAD that has advanced past the marker means this session ran against
  // stale code and must not be treated as the active run for the new HEAD.
  if (workspacePath && state.roleRunHead) {
    try {
      const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspacePath });
      const currentHead = stdout.trim();
      if (currentHead && currentHead !== state.roleRunHead) {
        console.log(
          `[cloister] ${issueId}: ${role} session ${candidateId} is stale `
          + `(ran against ${state.roleRunHead}, HEAD is now ${currentHead}) — not active`,
        );
        return false;
      }
    } catch { /* non-fatal — fall through to the status-only result */ }
  }

  return true;
}

function buildReactiveRolePrompt(issueId: string, state: string, role: Role): string {
  return `${role.toUpperCase()} TASK for ${issueId}:

The issue lifecycle transitioned to ${state}. Run the ${role} role for this issue.

Required steps:
1. Work only in the workspace configured for ${issueId}.
2. Read .pan/continue.json, .pan/spec.vbrief.json, project instructions, and issue context.
3. Follow the boundaries and success criteria in roles/${role}.md exactly.
4. Report the role-specific terminal status when done.`;
}

/**
 * Resolve the workspace path for an issue from agent state, then fall back
 * to the canonical `<projectPath>/workspaces/feature-<issueLower>` layout.
 * Mirrors the resolution used by startup recovery (service.ts:583-609) so
 * the reactive scheduler dispatches review/test wrappers with the same
 * workspace contract those wrappers receive on the manual code path.
 */
async function resolveWorkspaceForIssue(issueId: string): Promise<string | null> {
  const issueLower = issueId.toLowerCase();
  const agentState = await getAgentStateAsync(`agent-${issueLower}`);
  if (agentState?.workspace) return agentState.workspace;
  const resolved = resolveProjectFromIssue(issueId);
  if (!resolved) return null;
  return `${resolved.projectPath}/workspaces/feature-${issueLower}`;
}

/**
 * Reactive Cloister entrypoint: start the role that owns a new issue state.
 *
 * PAN-1048 review feedback 003: review and test roles dispatch through their
 * dedicated wrappers (spawnReviewRoleForIssue, dispatchTestAgentAndNotify)
 * instead of bare spawnRun(). The wrappers carry the contract pieces the
 * reactive path was previously dropping — review-temp stash, reviewSpawnedAt,
 * feedback archival, status-posting prompt, idempotency guards, and the
 * `/api/review/:issueId/status` integration that flips readyForMerge.
 */
export async function onIssueStateChange(issueId: string, newState: string): Promise<void> {
  const normalizedIssueId = normalizeIssueId(issueId);
  const role = stateToRole(newState);
  if (!role) {
    console.log(`[cloister] ${normalizedIssueId}: no role for issue state '${newState}'`);
    return;
  }

  // Resolve the workspace up front so activeRoleRunExists can probe the
  // workspace HEAD for stale-session (zombie) detection.
  const workspace = await resolveWorkspaceForIssue(normalizedIssueId);

  if (await activeRoleRunExists(normalizedIssueId, role, workspace ?? undefined)) {
    const message = `${normalizedIssueId}: ${role} role already active; skipping lifecycle spawn`;
    console.log(`[cloister] ${message}`);
    emitActivityEntry({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    return;
  }

  // activeRoleRunExists returned false. If a tmux session for this role still
  // physically exists, it's a zombie (agent finished work but never exited,
  // and the workspace HEAD has since advanced). Kill it before re-dispatch so
  // the fresh run gets a clean session name instead of colliding with the
  // dead one.
  const issueLower = normalizedIssueId.toLowerCase();
  const roleSessionId = role === 'work' ? `agent-${issueLower}` : `agent-${issueLower}-${role}`;
  if (await sessionExistsAsync(roleSessionId)) {
    const message = `${normalizedIssueId}: killing stale ${role} session ${roleSessionId} before re-dispatch`;
    console.log(`[cloister] ${message}`);
    emitActivityEntry({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
    try {
      await killSessionAsync(roleSessionId);
    } catch (err) {
      console.error(`[cloister] failed to kill stale session ${roleSessionId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  try {
    if (role === 'review') {
      if (!workspace) {
        const failure = `${normalizedIssueId}: cannot dispatch review role — no workspace or project resolved`;
        console.error(`[cloister] ${failure}`);
        emitActivityEntry({ source: 'cloister', level: 'error', message: failure, issueId: normalizedIssueId });
        return;
      }
      const branch = `feature/${normalizedIssueId.toLowerCase()}`;
      const { spawnReviewRoleForIssue } = await import('./review-agent.js');
      const result = await spawnReviewRoleForIssue({ issueId: normalizedIssueId, workspace, branch });
      const message = `${normalizedIssueId}: review role dispatched from lifecycle state '${newState}' (${result.message})`;
      console.log(`[cloister] ${message}`);
      emitActivityEntry({ source: 'cloister', level: result.success ? 'info' : 'error', message, issueId: normalizedIssueId });
      return;
    }

    if (role === 'test') {
      const branch = `feature/${normalizedIssueId.toLowerCase()}`;
      const { dispatchTestAgentAndNotify } = await import('./test-agent-queue.js');
      await dispatchTestAgentAndNotify(normalizedIssueId, workspace ?? undefined, branch);
      const message = `${normalizedIssueId}: test role dispatched from lifecycle state '${newState}'`;
      console.log(`[cloister] ${message}`);
      emitActivityEntry({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
      return;
    }

    const { spawnRun } = await import('../agents.js');
    const run = await spawnRun(normalizedIssueId, role, {
      prompt: buildReactiveRolePrompt(normalizedIssueId, newState, role),
    });
    const message = `${normalizedIssueId}: ${role} role started from lifecycle state '${newState}' as ${run.id}`;
    console.log(`[cloister] ${message}`);
    emitActivityEntry({ source: 'cloister', level: 'info', message, issueId: normalizedIssueId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already running')) {
      const skipMessage = `${normalizedIssueId}: ${role} role already running; skipping lifecycle spawn`;
      console.log(`[cloister] ${skipMessage}`);
      emitActivityEntry({ source: 'cloister', level: 'info', message: skipMessage, issueId: normalizedIssueId });
      return;
    }
    console.error(`[cloister] Failed to start ${role} role for ${normalizedIssueId}:`, error);
    emitActivityEntry({ source: 'cloister', level: 'error', message: `${normalizedIssueId}: failed to start ${role} role: ${message}`, issueId: normalizedIssueId });
  }
}

function payloadRecord(event: CloisterDomainEventLike): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
}

export function issueStateChangeFromDomainEvent(event: CloisterDomainEventLike): { issueId: string; state: string } | null {
  const payload = payloadRecord(event);
  const issueId = typeof payload.issueId === 'string' ? payload.issueId : null;
  if (!issueId) return null;

  switch (event.type) {
    case 'issue.transitioned':
      return typeof payload.state === 'string' ? { issueId, state: payload.state } : null;
    case 'issue.statusChanged':
      return typeof payload.canonicalStatus === 'string' ? { issueId, state: payload.canonicalStatus } : null;
    case 'issue.closed':
      return { issueId, state: 'closed' };
    case 'agent.completed': {
      // PAN-1048 review feedback 003: agent.completed is emitted by every
      // role's lifecycle (work, review, test, ship). Map it to in_review only
      // when the work role completes — letting other roles land here would
      // ricochet back into review the moment a review or test role finished.
      const role = typeof payload.role === 'string' ? payload.role : undefined;
      if (role === undefined || role === 'work') {
        return { issueId, state: 'in_review' };
      }
      return null;
    }
    case 'work.completed':
      return { issueId, state: 'in_review' };
    case 'review.approved':
      return { issueId, state: 'testing' };
    case 'test.passed':
      return { issueId, state: 'shipping' };
    default:
      return null;
  }
}

export async function handleCloisterDomainEvent(event: CloisterDomainEventLike): Promise<void> {
  const change = issueStateChangeFromDomainEvent(event);
  if (!change) return;
  await onIssueStateChange(change.issueId, change.state);
}

/**
 * Write Cloister running state to file for cross-process visibility
 */
function writeStateFile(running: boolean, pid?: number): void {
  try {
    if (running) {
      writeFileSync(CLOISTER_STATE_FILE, JSON.stringify({
        running: true,
        pid: pid || process.pid,
        startedAt: new Date().toISOString(),
      }));
    } else {
      if (existsSync(CLOISTER_STATE_FILE)) {
        unlinkSync(CLOISTER_STATE_FILE);
      }
    }
  } catch (error) {
    // Non-fatal - state file is for convenience
    console.warn('Failed to write Cloister state file:', error);
  }
}

/**
 * Read Cloister running state from file
 */
function readStateFile(): { running: boolean; pid?: number; startedAt?: string } {
  try {
    if (existsSync(CLOISTER_STATE_FILE)) {
      const data = JSON.parse(readFileSync(CLOISTER_STATE_FILE, 'utf-8'));
      // Verify the process is still running
      if (data.pid) {
        try {
          process.kill(data.pid, 0); // Signal 0 checks if process exists
          return data;
        } catch {
          // Process doesn't exist - clean up stale state file
          unlinkSync(CLOISTER_STATE_FILE);
          return { running: false };
        }
      }
      return data;
    }
  } catch {
    // State file doesn't exist or is corrupted
  }
  return { running: false };
}

/**
 * Cloister service status
 */
export interface CloisterStatus {
  running: boolean;
  lastCheck: Date | null;
  config: CloisterConfig;
  summary: HealthSummary;
  agentsNeedingAttention: string[];
}

/**
 * Agent crash tracker for auto-restart
 */
interface AgentCrashTracker {
  agentId: string;
  crashCount: number;
  lastCrash: Date;
  nextRetryAt?: Date;
  gaveUp: boolean;
}

/**
 * Cloister service event
 */
export type CloisterEvent =
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'health_check'; agentHealths: AgentHealth[] }
  | { type: 'agent_warning'; agentId: string; health: AgentHealth }
  | { type: 'agent_stuck'; agentId: string; health: AgentHealth }
  | { type: 'poked_agent'; agentId: string }
  | { type: 'killed_agent'; agentId: string }
  | { type: 'agent_crashed'; agentId: string; crashCount: number }
  | { type: 'agent_restarting'; agentId: string; crashCount: number; backoffSeconds: number }
  | { type: 'agent_restart_failed'; agentId: string; crashCount: number; error: string }
  | { type: 'agent_gave_up'; agentId: string; maxRetries: number }
  | { type: 'mass_death_detected'; deathCount: number; windowSeconds: number }
  | { type: 'spawn_paused'; reason: string }
  | { type: 'spawn_resumed' }
  | { type: 'fpp_violation_detected'; agentId: string; violation: FPPViolation }
  | { type: 'fpp_nudge_sent'; agentId: string; nudgeCount: number }
  | { type: 'fpp_max_nudges_exceeded'; agentId: string; violation: FPPViolation }
  | { type: 'cost_alert'; alert: CostAlert }
  | { type: 'session_rotated'; specialistName: string; result: SessionRotationResult }
  | { type: 'handoff_triggered'; agentId: string; trigger: TriggerDetection }
  | { type: 'handoff_completed'; agentId: string; result: HandoffResult }
  | { type: 'emergency_stop'; killedAgents: string[] }
  | { type: 'error'; error: Error };

/**
 * Cloister service event listener
 */
export type CloisterEventListener = (event: CloisterEvent) => void;

/**
 * Cloister Service
 *
 * Monitors agent health and performs auto-actions.
 */
export class CloisterService {
  private running: boolean = false;
  private starting: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastCheck: Date | null = null;
  private config: CloisterConfig;
  private listeners: CloisterEventListener[] = [];
  private previousStates: Map<string, HealthState> = new Map();
  private crashTrackers: Map<string, AgentCrashTracker> = new Map();
  private previousRunningAgents: Set<string> = new Set();
  private deathTimestamps: Date[] = []; // Rolling window of agent death times
  private spawnsPaused: boolean = false;
  private processedCompletions: Map<string, number> = new Map(); // Track completion marker retry counts (Infinity = done)
  private healthCheckCount: number = 0;
  private lastPokeTimestamps: Map<string, number> = new Map(); // agentId → last poke timestamp (ms)
  private domainEventUnsubscribe: (() => void) | null = null;

  // ─── Status cache ────────────────────────────────────────────────────────────
  // getStatus() does sync file I/O + tmux calls for every agent. Cache for 3s
  // to eliminate blocking on high-frequency dashboard polls.
  private _statusCache: CloisterStatus | null = null;
  private _statusCacheAt = 0;
  private readonly STATUS_CACHE_TTL_MS = 3_000;

  constructor(config?: CloisterConfig) {
    this.config = config || loadCloisterConfig();
  }

  private getDashboardApiUrl(): string {
    // Cloister always runs in-process with the dashboard, so it must talk to
    // its own loopback — never to a public DASHBOARD_URL like https://pan.localhost,
    // which would round-trip through Traefik+TLS and fail validation from inside
    // Node (PAN-845). Use 127.0.0.1 explicitly to avoid the IPv6-first /etc/hosts
    // trap (PAN-841): undici-based fetch connects to [::1] and hangs because the
    // dashboard listens on the IPv4 wildcard.
    return `http://127.0.0.1:${process.env.API_PORT || process.env.PORT || '3011'}`;
  }

  /**
   * Start the Cloister service
   */
  async start(): Promise<void> {
    if (this.running || this.starting) {
      console.warn('Cloister is already running');
      return;
    }
    this.starting = true;

    console.log('🔔 Starting Cloister agent watchdog...');

    // Initialize unified panopticon database (includes health_events table)
    try {
      getDatabase();
      console.log('  ✓ Panopticon database initialized');
    } catch (error) {
      console.error('  ✗ Failed to initialize panopticon database:', error);
    }

    try {
      await cleanupLegacySpecialistsDirectory();
      console.log('  ✓ Removed legacy ~/.panopticon/specialists directory');
    } catch (error) {
      console.error('  ✗ Failed to remove legacy specialists directory:', error);
    }

    // PAN-493: Reset orphaned verificationStatus === 'running' states.
    // If Cloister dies mid-verification, the status is left stuck at 'running' and the
    // pipeline halts indefinitely. On startup, reset any such states to 'pending' so
    // verification reruns automatically. Verification is idempotent — this is always safe.
    let resetVerificationCount = 0;
    try {
      const statuses = loadReviewStatuses();
      for (const [issueId, status] of Object.entries(statuses)) {
        if (status.verificationStatus === 'running') {
          setReviewStatus(issueId, { verificationStatus: 'pending' });
          console.log(`  ✓ Reset orphaned verification 'running' → 'pending' for ${issueId}`);
          resetVerificationCount++;
        }
      }
      if (resetVerificationCount > 0) {
        emitActivityEntry({ source: 'cloister', level: 'warn', message: `Reset ${resetVerificationCount} orphaned verification 'running' → 'pending' on startup` });
      }
    } catch (error) {
      console.error('  ✗ Failed to reset orphaned verification states:', error);
    }

    // PAN-511: Clear stale currentIssue from specialist agents that are not actually running.
    // If Cloister dies while a specialist is between tasks or mid-run, the specialist's
    // runtime.json may retain currentIssue and state='active' even though the process is dead.
    // spawnEphemeralSpecialist checks these fields to decide whether
    // to dispatch — a stale 'active' state permanently blocks new dispatches.
    // On startup, clear currentIssue and reset state from any specialist agent that is:
    //   (a) idle — safe: idle means no active task, currentIssue is leftover
    //   (b) active but tmux session no longer running — state is stale from a crash
    let clearedSpecialistCount = 0;
    try {
      if (existsSync(AGENTS_DIR)) {
        const { isRunning: isSpecialistRunning } = await import('./specialists.js');
        const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const parsed = parseSpecialistAgentSession(entry.name);
          if (!parsed) continue;
          const runtimeState = getAgentRuntimeState(entry.name);
          if (!runtimeState?.currentIssue) continue;

          if (runtimeState.state === 'idle') {
            saveAgentRuntimeState(entry.name, { currentIssue: undefined });
            console.log(`  ✓ Cleared stale currentIssue '${runtimeState.currentIssue}' from idle ${entry.name}`);
            clearedSpecialistCount++;
          } else if (runtimeState.state === 'active') {
            // Check if the process is actually alive — if not, the state is stale from a crash.
            // For issue-scoped specialists, check the exact tmux session instead of the legacy
            // project/type singleton lookup, which cannot represent PAN-754 session identity.
            const stillRunning = parsed.issueId
              ? await sessionExistsAsync(entry.name)
              : await isSpecialistRunning(parsed.specialistType, parsed.projectKey);
            if (!stillRunning) {
              saveAgentRuntimeState(entry.name, {
                state: 'idle',
                lastActivity: new Date().toISOString(),
                currentIssue: undefined,
              });
              console.log(`  ✓ Cleared stale active state for crashed specialist ${entry.name} (was working on '${runtimeState.currentIssue}')`);
              clearedSpecialistCount++;
            }
          }
        }
      }
      if (clearedSpecialistCount > 0) {
        emitActivityEntry({ source: 'cloister', level: 'warn', message: `Cleared ${clearedSpecialistCount} stale specialist state(s) on startup` });
      }
    } catch (error) {
      console.error('  ✗ Failed to clear stale specialist states:', error);
    }

    // PAN-511: Startup recovery for orphaned reviewStatus='reviewing' issues.
    // If Cloister crashes after reviewStatus was set to 'reviewing' but before the specialist
    // completes, the issue is stuck. On startup, find such issues and re-dispatch directly.
    try {
      const reviewStatuses = loadReviewStatuses();
      const { resolveProjectFromIssue } = await import('../projects.js');
      const { getTmuxSessionName, getAllProjectSpecialistStatuses } = await import('./specialists.js');

      // Build set of issue IDs actively being reviewed by a running specialist
      const activeReviewIssues = new Set<string>();
      try {
        const projSpecs = await getAllProjectSpecialistStatuses();
        for (const ps of projSpecs) {
          if (ps.specialistType !== 'review-agent' || !ps.isRunning) continue;
          const rs = getAgentRuntimeState(ps.tmuxSession);
          if (rs?.state === 'active' && rs.currentIssue) {
            activeReviewIssues.add(rs.currentIssue.toUpperCase());
          }
        }
        // Also check global review-agent session
        const globalSession = getTmuxSessionName('review-agent');
        const globalRs = getAgentRuntimeState(globalSession);
        if (globalRs?.state === 'active' && globalRs.currentIssue) {
          activeReviewIssues.add(globalRs.currentIssue.toUpperCase());
        }

        // PAN-1048 R5: detect role-primitive review runs (agent-<id>-review).
        // Replaces the legacy getActiveParallelReviewIssues helper that scanned
        // tmux for dispatchParallelReview's coordinator session naming pattern.
        const { listRunningAgentsAsync } = await import('../agents.js');
        const agents = await listRunningAgentsAsync();
        for (const agent of agents) {
          if (agent.status === 'stopped' || agent.status === 'error') continue;
          const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : null);
          if (role !== 'review') continue;
          const issueId = (agent.issueId ?? '').trim().toUpperCase();
          if (issueId) activeReviewIssues.add(issueId);
        }
      } catch {
        // Non-fatal: if we can't check active sessions, re-dispatch all orphaned
      }

      const orphanedReviewing = identifyOrphanedReviewingIssues(reviewStatuses, activeReviewIssues);

      if (orphanedReviewing.length > 0) {
        console.log(`  ⚠ Found ${orphanedReviewing.length} issue(s) with orphaned reviewStatus='reviewing'`);
        emitActivityEntry({ source: 'cloister', level: 'warn', message: `Found ${orphanedReviewing.length} orphaned reviewStatus='reviewing' issue(s) on startup`, details: orphanedReviewing.join(', ') });

        for (const issueId of orphanedReviewing) {

          const agentId = `agent-${issueId.toLowerCase()}`;
          const agentState = getAgentState(agentId);
          const workspace = agentState?.workspace;

          if (!workspace) {
            console.log(`  ⚠ ${issueId}: orphaned reviewing but no workspace found — resetting to pending`);
            setReviewStatus(issueId, { reviewStatus: 'pending' });
            emitActivityEntry({ source: 'cloister', level: 'warn', message: `${issueId} orphaned reviewing reset to pending — no workspace found`, issueId });
            continue;
          }

          const resolved = resolveProjectFromIssue(issueId);
          if (!resolved) {
            console.log(`  ⚠ ${issueId}: orphaned reviewing but no project configured — resetting to pending`);
            setReviewStatus(issueId, { reviewStatus: 'pending' });
            emitActivityEntry({ source: 'cloister', level: 'warn', message: `${issueId} orphaned reviewing reset to pending — no project configured`, issueId });
            continue;
          }

          const branch = `feature/${issueId.toLowerCase()}`;
          // PAN-1048 R4: startup recovery now spawns the review role primitive
          // (loads roles/review.md → Agent tool fans out to convoy reviewers)
          // instead of the legacy `pan review run` coordinator.
          const { spawnReviewRoleForIssue } = await import('./review-agent.js');
          await spawnReviewRoleForIssue({ issueId, workspace, branch });
          // spawnReviewRoleForIssue sets reviewStatus='reviewing' internally
          console.log(`  ✓ Re-dispatched recovery review for ${issueId}`);
          emitActivityEntry({ source: 'cloister', level: 'info', message: `Re-dispatched recovery review for ${issueId}`, issueId });
        }
      }
    } catch (error) {
      console.error('  ✗ Failed to recover orphaned reviewing issues:', error);
    }

    // PAN-378: Global specialists removed — per-project ephemeral specialists handle all work.
    // No initialization needed; specialists are spawned on-demand via spawnEphemeralSpecialist().
    console.log('  → Specialists: per-project ephemeral mode (no global pool)');

    // Start deacon health monitor for specialists
    try {
      console.log('  → Starting deacon health monitor...');
      startDeacon();
      console.log('  ✓ Deacon started');
      emitActivityEntry({ source: 'cloister', level: 'info', message: 'Deacon health monitor started' });
    } catch (error) {
      console.error('  ✗ Failed to start deacon:', error);
      emitActivityEntry({ source: 'cloister', level: 'error', message: `Failed to start deacon: ${error instanceof Error ? error.message : String(error)}` });
    }

    this.running = true;
    this.starting = false;
    this._statusCache = null;
    writeStateFile(true);
    this.emit({ type: 'started' });
    emitActivityEntry({ source: 'cloister', level: 'info', message: 'Cloister agent watchdog started' });

    await this.subscribeToDomainEvents();

    // Start monitoring loop
    this.startMonitoringLoop();
  }

  private async subscribeToDomainEvents(): Promise<void> {
    if (this.domainEventUnsubscribe) return;

    try {
      const { initEventStore } = await import('../../dashboard/server/event-store.js');
      const store = await initEventStore();
      this.domainEventUnsubscribe = store.subscribe((event) => {
        void handleCloisterDomainEvent(event).catch((error) => {
          console.error('[cloister] Reactive lifecycle event handling failed:', error);
          emitActivityEntry({
            source: 'cloister',
            level: 'error',
            message: `Reactive lifecycle event handling failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      });
      console.log('  ✓ Cloister reactive lifecycle scheduler subscribed to domain events');
    } catch (error) {
      console.error('  ✗ Failed to subscribe Cloister reactive lifecycle scheduler:', error);
      emitActivityEntry({
        source: 'cloister',
        level: 'error',
        message: `Failed to subscribe reactive lifecycle scheduler: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Stop the Cloister service
   *
   * Note: This stops monitoring but does NOT kill agents.
   * Use emergencyStop() to kill all agents.
   */
  stop(): void {
    if (!this.running) {
      console.warn('Cloister is not running');
      return;
    }

    console.log('🔔 Stopping Cloister agent watchdog...');
    this.running = false;
    this._statusCache = null;
    writeStateFile(false);

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.domainEventUnsubscribe) {
      this.domainEventUnsubscribe();
      this.domainEventUnsubscribe = null;
    }

    // Stop deacon health monitor
    try {
      stopDeacon();
      console.log('  ✓ Deacon stopped');
    } catch (error) {
      console.error('Failed to stop deacon:', error);
    }

    // Close database connection
    try {
      closeDatabase();
    } catch (error) {
      console.error('Failed to close panopticon database:', error);
    }

    this.emit({ type: 'stopped' });
  }

  /**
   * Emergency stop - kill ALL agents immediately
   *
   * This is the nuclear option. Use with caution.
   */
  emergencyStop(): string[] {
    console.log('🚨 EMERGENCY STOP - Killing all agents');

    const runningAgents = listRunningAgents();
    const killedAgents: string[] = [];

    for (const agent of runningAgents) {
      if (agent.tmuxActive) {
        try {
          const runtime = getRuntimeForAgent(agent.id);
          if (runtime) {
            runtime.killAgent(agent.id); // killAgent already resets runtime.json to idle
            killedAgents.push(agent.id);
            console.log(`  ✓ Killed ${agent.id}`);
          }
        } catch (error) {
          console.error(`  ✗ Failed to kill ${agent.id}:`, error);
        }
      }
    }

    this.emit({ type: 'emergency_stop', killedAgents });

    // Stop monitoring after emergency stop
    this.stop();

    return killedAgents;
  }

  /**
   * Start the monitoring loop
   */
  private startMonitoringLoop(): void {
    // Run initial check immediately
    this.performHealthCheck();

    // Schedule periodic checks
    const intervalMs = this.config.monitoring.check_interval * 1000;
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
  }

  /**
   * Perform a health check on all running agents
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const runningAgents = listRunningAgents().filter((a) => a.tmuxActive);
      const agentIds = runningAgents.map((a) => a.id);
      const currentRunningSet = new Set(agentIds);

      // Detect crashed agents (were running before, not running now)
      if (this.previousRunningAgents.size > 0 && this.config.auto_restart?.enabled) {
        for (const previousAgentId of this.previousRunningAgents) {
          if (!currentRunningSet.has(previousAgentId)) {
            // Agent crashed!
            await this.handleAgentCrash(previousAgentId);
          }
        }
      }

      // Update the set of running agents for next check
      this.previousRunningAgents = currentRunningSet;

      // Completion marker check runs regardless of active agents —
      // completed agents won't have tmux sessions anymore
      this.healthCheckCount++;
      if (this.healthCheckCount % 4 === 0) {
        void this.checkCompletionMarkers();
      }

      if (agentIds.length === 0) {
        this.lastCheck = new Date();
        return;
      }

      // Get health for all agents
      const agentHealths: AgentHealth[] = [];

      for (const agentId of agentIds) {
        const runtime = getRuntimeForAgent(agentId);
        if (runtime) {
          const health = getAgentHealth(agentId, runtime);
          agentHealths.push(health);

          // Write health event to database
          this.recordHealthEvent(health);
        }
      }

      this.lastCheck = new Date();
      this.emit({ type: 'health_check', agentHealths });

      // Check for agents needing attention
      const needsAttention = getAgentsNeedingAttention(agentHealths);

      const pokeCooldownMs = this.config.auto_actions.poke_cooldown_ms ?? 30 * 60 * 1000;
      const now = Date.now();

      for (const health of needsAttention) {
        const lastPoke = this.lastPokeTimestamps.get(health.agentId) ?? 0;
        const cooledDown = (now - lastPoke) >= pokeCooldownMs;

        if (health.state === 'warning') {
          this.emit({ type: 'agent_warning', agentId: health.agentId, health });

          // Auto-poke if configured and cooldown elapsed
          if (this.config.auto_actions.poke_on_warning && cooledDown) {
            this.pokeAgent(health.agentId);
            this.lastPokeTimestamps.set(health.agentId, now);
          }
        } else if (health.state === 'stuck') {
          this.emit({ type: 'agent_stuck', agentId: health.agentId, health });

          // Auto-poke stuck agents if configured and cooldown elapsed
          if ((this.config.auto_actions.poke_on_stuck ?? true) && cooledDown) {
            this.pokeAgent(health.agentId);
            this.lastPokeTimestamps.set(health.agentId, now);
          }

          // Auto-kill if configured (dangerous!)
          if (this.config.auto_actions.kill_on_stuck) {
            this.killAgent(health.agentId);
          }
        }
      }

      // Check for handoff triggers (Phase 4)
      // Note: Intentionally not awaiting - runs in background
      void this.checkHandoffTriggers(agentHealths);

      // Check for FPP violations (Phase 6)
      this.checkFPPViolations(agentIds);

      // Check cost limits (Phase 6)
      this.checkCostAlerts(agentIds);

      // Check for specialist session rotation needs (Phase 6)
      // Only check periodically (every ~10 checks)
      if (Math.random() < 0.1) {
        void this.checkSpecialistRotations();
      }

      // Clean up old resolved violations (daily)
      if (Math.random() < 0.01) {
        // ~1% chance each check = roughly once per day
        clearOldViolations(24);
      }
    } catch (error) {
      console.error('Cloister health check failed:', error);
      this.emit({ type: 'error', error: error as Error });
    }
  }

  /**
   * Scan for agent completion markers and auto-trigger review.
   * This is the fallback for when `pan done` fails to reach the dashboard via HTTP.
   */
  private async checkCompletionMarkers(): Promise<void> {
    try {
      if (!existsSync(AGENTS_DIR)) return;

      const agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('agent-'));

      for (const dir of agentDirs) {
        const completedFile = join(AGENTS_DIR, dir.name, 'completed');
        const processedFile = join(AGENTS_DIR, dir.name, 'completed.processed');

        // Skip if no completion marker.
        if (!existsSync(completedFile)) continue;

        // If a stale `completed.processed` exists from a prior round, it must
        // not block a NEW completion. `pan done` for a feedback round writes
        // a fresh `completed` and unlinks `.processed`, but if the unlink
        // didn't happen (older client, races, manual recovery), fall back to
        // an mtime comparison: if `completed` is newer than `.processed`,
        // treat it as a new event and remove the stale processed marker.
        if (existsSync(processedFile)) {
          try {
            const completedMtime = statSync(completedFile).mtimeMs;
            const processedMtime = statSync(processedFile).mtimeMs;
            if (completedMtime > processedMtime) {
              try { unlinkSync(processedFile); } catch {}
              this.processedCompletions.delete(dir.name);
              console.log(`🔔 Cloister: Detected re-completion for ${dir.name} (completed newer than .processed) — clearing stale marker`);
            } else {
              continue;
            }
          } catch {
            continue;
          }
        }

        // Skip stale completion markers (older than 24h) — just mark as processed
        try {
          const content = JSON.parse(readFileSync(completedFile, 'utf-8'));
          const ageMs = Date.now() - new Date(content.timestamp).getTime();
          if (ageMs > 24 * 60 * 60 * 1000) {
            console.log(`🔔 Cloister: Skipping stale completion marker for ${dir.name} (${Math.floor(ageMs / 3600000)}h old)`);
            this.processedCompletions.set(dir.name, Infinity);
            try { renameSync(completedFile, processedFile); } catch {}
            continue;
          }
        } catch (parseErr) {
          console.warn(`  ⚠ Cloister: Could not parse completion marker for ${dir.name}, skipping`);
          continue;
        }

        // Check retry count — give up after 3 failed attempts.
        // If `.processed` was unlinked (e.g. by a re-run of `pan done` after a
        // review feedback round), the on-disk state says "fresh completion" —
        // reset any stale in-memory counter from the previous round so the
        // trigger fires again.
        const retryCount = this.processedCompletions.get(dir.name) || 0;
        if (retryCount === Infinity) {
          this.processedCompletions.delete(dir.name);
        } else if (retryCount >= 3) continue;

        // Extract issue ID from agent dir name (e.g. "agent-pan-123" → "PAN-123")
        const issueId = dir.name.replace('agent-', '').toUpperCase();

        // Skip if review is already in progress or passed — `pan done` already triggered it.
        // This completion marker scan is only a fallback for when the HTTP call from `pan done` fails.
        const { getReviewStatus } = await import('../review-status.js');
        const existingReview = getReviewStatus(issueId);
        if (existingReview && ['reviewing', 'passed'].includes(existingReview.reviewStatus || '')) {
          console.log(`🔔 Cloister: Completion marker for ${issueId} — review already ${existingReview.reviewStatus}, marking processed`);
          try { renameSync(completedFile, processedFile); } catch {}
          this.processedCompletions.set(dir.name, Infinity);
          continue;
        }

        console.log(`🔔 Cloister: Found completion marker for ${issueId}, triggering review...${retryCount > 0 ? ` (retry ${retryCount}/3)` : ''}`);

        try {
          // Trigger review via dashboard API. Use fetch() so https:// URLs
          // (e.g. https://pan.localhost via Traefik) work — Node's http.request
          // rejects https URLs with "Protocol \"https:\" not supported".
          const result = await (async (): Promise<{ success: boolean; error?: string; alreadyReviewed?: boolean; alreadyMerged?: boolean }> => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
              const res = await fetch(`${this.getDashboardApiUrl()}/api/review/${issueId}/trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
                signal: controller.signal,
              });
              clearTimeout(timer);
              try {
                return (await res.json()) as { success: boolean; error?: string; alreadyReviewed?: boolean; alreadyMerged?: boolean };
              } catch {
                return { success: false, error: `Invalid response (HTTP ${res.status})` };
              }
            } catch (e: any) {
              clearTimeout(timer);
              if (e?.name === 'AbortError') return { success: false, error: 'Timeout (5s)' };
              return { success: false, error: e?.message || String(e) };
            }
          })();

          if (result.success) {
            console.log(`  ✓ Review triggered for ${issueId}`);
            renameSync(completedFile, processedFile);
            this.processedCompletions.set(dir.name, Infinity);
          } else if (result.alreadyReviewed || result.alreadyMerged) {
            // Terminal state — already handled, mark as processed
            console.log(`  ✓ ${issueId} already ${result.alreadyMerged ? 'merged' : 'reviewed'}, marking processed`);
            renameSync(completedFile, processedFile);
            this.processedCompletions.set(dir.name, Infinity);
          } else {
            // Transient failure — increment retry count, will retry on next cycle
            this.processedCompletions.set(dir.name, retryCount + 1);
            console.log(`  ⚠ Review trigger failed for ${issueId}: ${result.error || 'unknown'} (will retry, ${2 - retryCount} attempts left)`);
          }
        } catch (err: any) {
          this.processedCompletions.set(dir.name, retryCount + 1);
          console.error(`  ✗ Failed to trigger review for ${issueId}: ${err.message} (will retry, ${2 - retryCount} attempts left)`);
        }
      }
    } catch (error) {
      // Non-fatal - just skip this check
    }
  }

  /**
   * Poke an agent (send "are you stuck?" message).
   *
   * NOTE: runtime.sendMessage() is async — both ClaudeCodeRuntime and PiRuntime
   * are declared `async sendMessage(): Promise<void>`. A `throw` inside an
   * async function before any await still returns a rejected Promise, so the
   * surrounding try/catch CANNOT catch it. Without explicit `.catch()`, the
   * rejection becomes an UnhandledPromiseRejection and crashes the dashboard
   * server. We hit this in production when the deacon health-check polled a
   * dead agent (PAN-1189 wedge sweep #12-13).
   */
  private pokeAgent(agentId: string): void {
    try {
      const runtime = getRuntimeForAgent(agentId);
      if (!runtime) {
        throw new Error(`No runtime found for agent ${agentId}`);
      }

      const pokeMessage =
        'Hey, I noticed you haven\'t made progress in a while. Are you stuck? ' +
        'If you need help or clarification, please ask. Otherwise, please continue with your work.';

      // Fire-and-forget: chain .catch() so async rejection cannot bubble out
      // as an UnhandledPromiseRejection.
      Promise.resolve(runtime.sendMessage(agentId, pokeMessage)).catch((sendErr) => {
        console.error(`Failed to send poke to ${agentId}:`, sendErr);
      });
      this.emit({ type: 'poked_agent', agentId });

      console.log(`🔔 Poked ${agentId}`);
    } catch (error) {
      console.error(`Failed to poke ${agentId}:`, error);
    }
  }

  /**
   * Kill an agent
   *
   * runtime.killAgent() is also async in some runtime implementations — apply
   * the same fire-and-forget guard as pokeAgent so async rejection cannot
   * crash the dashboard from a deacon health-check timer callback.
   */
  private killAgent(agentId: string): void {
    try {
      const runtime = getRuntimeForAgent(agentId);
      if (!runtime) {
        throw new Error(`No runtime found for agent ${agentId}`);
      }

      Promise.resolve(runtime.killAgent(agentId)).catch((killErr) => {
        console.error(`Failed to kill ${agentId}:`, killErr);
      });
      this.emit({ type: 'killed_agent', agentId });

      console.log(`🔔 Killed ${agentId}`);
    } catch (error) {
      console.error(`Failed to kill ${agentId}:`, error);
    }
  }

  /**
   * Handle agent crash with auto-restart logic
   */
  private async handleAgentCrash(agentId: string): Promise<void> {
    const config = this.config.auto_restart;
    if (!config?.enabled) return;

    // Check if agent was intentionally stopped or suspended (not a crash).
    // Both state.json and runtime.json must be checked — stopAgent writes both,
    // but a race between the CLI kill and this health check poll could see one
    // but not the other if only one file is consulted.
    const agentState = getAgentState(agentId);
    if (!agentState || agentState.status === 'stopped') {
      console.log(`🔔 Agent ${agentId} was intentionally stopped, skipping restart`);
      return;
    }
    const runtimeState = getAgentRuntimeState(agentId);
    if (runtimeState?.state === 'suspended') {
      console.log(`🔔 Agent ${agentId} is suspended, skipping restart`);
      return;
    }
    if (runtimeState?.state === 'stopped') {
      console.log(`🔔 Agent ${agentId} runtime is stopped, skipping restart`);
      return;
    }

    // Record death timestamp for mass death detection
    const now = new Date();
    this.deathTimestamps.push(now);
    this.checkForMassDeaths();

    // Get or create crash tracker
    let tracker = this.crashTrackers.get(agentId);
    if (!tracker) {
      tracker = {
        agentId,
        crashCount: 0,
        lastCrash: now,
        gaveUp: false,
      };
      this.crashTrackers.set(agentId, tracker);
    }

    // Skip if we've already given up on this agent
    if (tracker.gaveUp) return;

    // Increment crash count
    tracker.crashCount++;
    tracker.lastCrash = now;

    this.emit({ type: 'agent_crashed', agentId, crashCount: tracker.crashCount });
    console.log(`🔔 Agent ${agentId} crashed (crash #${tracker.crashCount})`);

    // Check if we've exceeded max retries
    if (tracker.crashCount > config.max_retries) {
      tracker.gaveUp = true;
      this.emit({ type: 'agent_gave_up', agentId, maxRetries: config.max_retries });
      console.error(`🔔 Gave up on restarting ${agentId} after ${config.max_retries} attempts`);
      return;
    }

    // Calculate backoff delay
    const backoffIndex = Math.min(tracker.crashCount - 1, config.backoff_seconds.length - 1);
    const backoffSeconds = config.backoff_seconds[backoffIndex];
    const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
    tracker.nextRetryAt = nextRetryAt;

    this.emit({
      type: 'agent_restarting',
      agentId,
      crashCount: tracker.crashCount,
      backoffSeconds,
    });

    console.log(
      `🔔 Will restart ${agentId} in ${backoffSeconds}s (attempt ${tracker.crashCount}/${config.max_retries})`
    );

    // Schedule restart after backoff
    setTimeout(async () => {
      try {
        await this.restartAgent(agentId);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.emit({
          type: 'agent_restart_failed',
          agentId,
          crashCount: tracker!.crashCount,
          error: errorMessage,
        });
        console.error(`🔔 Failed to restart ${agentId}:`, error);
      }
    }, backoffSeconds * 1000);
  }

  /**
   * Restart an agent using its saved session
   */
  private async restartAgent(agentId: string): Promise<void> {
    const runtime = getRuntimeForAgent(agentId);
    if (!runtime) {
      throw new Error(`No runtime found for agent ${agentId}`);
    }

    // Get agent state to find session ID and workspace
    const agentState = getAgentState(agentId);
    if (!agentState?.sessionId) {
      throw new Error(`No session ID found for agent ${agentId}`);
    }

    if (!agentState.workspace) {
      throw new Error(`No workspace found for agent ${agentId}`);
    }

    // Restart with --resume using spawnAgent with sessionId
    console.log(`🔔 Restarting ${agentId} with session ${agentState.sessionId.substring(0, 8)}...`);
    runtime.spawnAgent({
      agentId,
      workspace: agentState.workspace,
      sessionId: agentState.sessionId,
      runtime: runtime.name,
    });
    console.log(`🔔 Successfully restarted ${agentId}`);
  }

  /**
   * Check for mass death events
   *
   * Detects when 3+ agents die within 30 seconds and pauses spawns.
   */
  private checkForMassDeaths(): void {
    const MASS_DEATH_THRESHOLD = 3;
    const WINDOW_SECONDS = 30;

    const now = Date.now();
    const windowStart = now - WINDOW_SECONDS * 1000;

    // Clean up old timestamps outside the window
    this.deathTimestamps = this.deathTimestamps.filter(
      (timestamp) => timestamp.getTime() >= windowStart
    );

    // Check if we have mass deaths
    if (this.deathTimestamps.length >= MASS_DEATH_THRESHOLD) {
      // Trigger mass death alert
      this.emit({
        type: 'mass_death_detected',
        deathCount: this.deathTimestamps.length,
        windowSeconds: WINDOW_SECONDS,
      });

      // Pause spawns
      if (!this.spawnsPaused) {
        this.pauseSpawns('Mass death detected - system stability concern');
        console.error(
          `🔔 MASS DEATH DETECTED: ${this.deathTimestamps.length} agents died in ${WINDOW_SECONDS}s - spawns paused`
        );
      }
    }
  }

  /**
   * Pause new agent spawns
   */
  private pauseSpawns(reason: string): void {
    this.spawnsPaused = true;
    this.emit({ type: 'spawn_paused', reason });
    console.log(`🔔 Agent spawns paused: ${reason}`);
  }

  /**
   * Resume agent spawns
   *
   * Called manually after user acknowledges mass death alert.
   */
  resumeSpawns(): void {
    this.spawnsPaused = false;
    this.deathTimestamps = []; // Clear death window
    this.emit({ type: 'spawn_resumed' });
    console.log(`🔔 Agent spawns resumed`);
  }

  /**
   * Check if spawns are currently paused
   */
  isSpawnPaused(): boolean {
    return this.spawnsPaused;
  }

  /**
   * Check for FPP violations and send nudges
   */
  private checkFPPViolations(agentIds: string[]): void {
    for (const agentId of agentIds) {
      const violation = checkAgentForViolations(agentId);
      if (!violation) continue;

      // New violation detected
      if (violation.nudgeCount === 0) {
        this.emit({ type: 'fpp_violation_detected', agentId, violation });
      }

      // Check if we should send a nudge
      const timeSinceLastNudge = violation.lastNudgeAt
        ? Date.now() - new Date(violation.lastNudgeAt).getTime()
        : Infinity;

      // Send nudge every 5 minutes until max nudges
      const NUDGE_INTERVAL_MS = 5 * 60 * 1000;
      if (timeSinceLastNudge >= NUDGE_INTERVAL_MS || violation.nudgeCount === 0) {
        if (hasExceededMaxNudges(violation)) {
          // Max nudges exceeded - alert user
          this.emit({ type: 'fpp_max_nudges_exceeded', agentId, violation });
          console.error(
            `🔔 Agent ${agentId} exceeded max nudges for ${violation.type} - manual intervention required`
          );
        } else {
          // Send nudge
          const sent = sendNudge(violation);
          if (sent) {
            this.emit({ type: 'fpp_nudge_sent', agentId, nudgeCount: violation.nudgeCount });
          }
        }
      }
    }
  }

  /**
   * Check for cost limit alerts
   */
  private checkCostAlerts(agentIds: string[]): void {
    const config = this.config.cost_limits;
    if (!config) return;

    for (const agentId of agentIds) {
      // Extract issue ID from agent ID (format: agent-issue-123 or issue-123)
      const issueId = agentId.startsWith('agent-')
        ? agentId.replace(/^agent-/, '')
        : agentId;

      const alerts = checkCostLimits(agentId, issueId, config);
      for (const alert of alerts) {
        this.emit({ type: 'cost_alert', alert });

        // Log the alert
        if (alert.level === 'limit_reached') {
          console.error(
            `🔔 COST LIMIT REACHED: ${alert.type} for ${alert.agentId || alert.issueId} - $${alert.currentCost.toFixed(2)} / $${alert.limit.toFixed(2)}`
          );
        } else {
          console.warn(
            `🔔 Cost warning: ${alert.type} for ${alert.agentId || alert.issueId} at ${alert.percentUsed.toFixed(0)}% ($${alert.currentCost.toFixed(2)} / $${alert.limit.toFixed(2)})`
          );
        }
      }
    }
  }

  /**
   * Get cost summary
   */
  getCostSummary() {
    return getCostSummary();
  }

  /**
   * Check if any specialists need session rotation
   */
  private async checkSpecialistRotations(): Promise<void> {
    // Check merge-agent (the main candidate for rotation)
    const mergeAgentResult = await checkAndRotateIfNeeded('merge-agent', process.cwd());
    if (mergeAgentResult) {
      this.emit({ type: 'session_rotated', specialistName: 'merge-agent', result: mergeAgentResult });

      if (mergeAgentResult.success) {
        console.log(
          `🔔 Rotated merge-agent session: ${mergeAgentResult.oldSessionId.substring(0, 8)} → ${mergeAgentResult.newSessionId?.substring(0, 8)}`
        );
      } else {
        console.error(`🔔 Failed to rotate merge-agent: ${mergeAgentResult.error}`);
      }
    }

    // Could check other specialists here if needed
  }

  /**
   * Record health event to database
   *
   * Only writes events when state changes or on first check.
   */
  private recordHealthEvent(health: AgentHealth): void {
    try {
      const currentState = health.state;
      const previousState = this.previousStates.get(health.agentId);

      // Only write event if state changed or this is first check
      if (previousState === undefined || previousState !== currentState) {
        // Determine source from heartbeat
        const source = health.heartbeat?.source
          ? this.mapHeartbeatSource(health.heartbeat.source)
          : 'unknown';

        writeHealthEvent({
          agentId: health.agentId,
          timestamp: new Date().toISOString(),
          state: currentState,
          previousState: previousState,
          source,
          metadata: health.heartbeat
            ? JSON.stringify({
                confidence: health.heartbeat.confidence,
                lastAction: health.heartbeat.lastAction,
                toolName: health.heartbeat.toolName,
                timeSinceActivity: health.timeSinceActivity,
              })
            : undefined,
        });

        // Update tracked state
        this.previousStates.set(health.agentId, currentState);
      }
    } catch (error) {
      console.error(`Failed to record health event for ${health.agentId}:`, error);
    }
  }

  /**
   * Check for handoff triggers and execute handoffs (Phase 4)
   *
   * Checks all triggers for each agent and performs handoffs when triggered.
   */
  private async checkHandoffTriggers(agentHealths: AgentHealth[]): Promise<void> {
    for (const health of agentHealths) {
      try {
        // Get agent state
        const agentState = getAgentState(health.agentId);
        if (!agentState) continue;

        // Skip if no workspace (can't determine context)
        if (!agentState.workspace) continue;

        // Check all triggers
        const triggers = await checkAllTriggers(
          health.agentId,
          agentState.workspace,
          agentState.issueId,
          agentState.model,
          health,
          this.config
        );

        // Execute handoff for first triggered condition
        // (Priority: stuck > planning > test > completion)
        if (triggers.length > 0) {
          const trigger = triggers[0];

          // task_complete triggers with a specialist name (e.g. 'test-agent') as suggestedModel
          // are handled by the `pan done` → completion marker → specialist pipeline flow.
          // Do NOT perform a model-swap handoff here — it passes the specialist name as a model ID
          // which is invalid and causes the agent to respawn with an unusable model.
          const specialistNames = ['review-agent', 'test-agent', 'merge-agent', 'inspect-agent', 'uat-agent'];
          if (trigger.type === 'task_complete' && specialistNames.includes(trigger.suggestedModel || '')) {
            console.log(`[cloister] Skipping handoff for ${health.agentId}: task_complete triggers specialist dispatch via completion marker, not model swap`);
            continue;
          }

          this.emit({ type: 'handoff_triggered', agentId: health.agentId, trigger });

          console.log(`🔔 Handoff triggered for ${health.agentId}: ${trigger.reason}`);

          // Perform handoff
          const result = await performHandoff(health.agentId, {
            targetModel: trigger.suggestedModel || 'sonnet',
            reason: trigger.reason,
          });

          this.emit({ type: 'handoff_completed', agentId: health.agentId, result });

          // Log handoff event
          if (result.context) {
            const event = createHandoffEvent(
              health.agentId,
              agentState.issueId,
              result.context,
              trigger.type,
              result.success,
              result.error
            );
            logHandoffEvent(event);
          }

          if (result.success) {
            console.log(`✓ Handoff completed: ${health.agentId} → ${result.newAgentId} (${trigger.suggestedModel})`);
          } else {
            console.error(`✗ Handoff failed: ${result.error}`);
          }
        }
      } catch (error) {
        console.error(`Failed to check handoff triggers for ${health.agentId}:`, error);
      }
    }
  }

  /**
   * Map heartbeat source to database source string
   */
  private mapHeartbeatSource(source: string): string {
    switch (source) {
      case 'jsonl':
        return 'jsonl_mtime';
      case 'tmux':
        return 'tmux_activity';
      case 'git':
        return 'git_activity';
      case 'active-heartbeat':
        return 'active_heartbeat';
      default:
        return source;
    }
  }

  /**
   * Get current status
   *
   * Uses a 3-second TTL cache to avoid blocking the event loop on repeated
   * dashboard polls. The underlying computation does sync file I/O and tmux
   * calls for every agent, which scales poorly with agent count.
   */
  getStatus(): CloisterStatus {
    const now = Date.now();
    if (this._statusCache && now - this._statusCacheAt < this.STATUS_CACHE_TTL_MS) {
      return this._statusCache;
    }

    const runningAgents = listRunningAgents().filter((a) => a.tmuxActive);
    const agentIds = runningAgents.map((a) => a.id);

    const agentHealths: AgentHealth[] = [];

    for (const agentId of agentIds) {
      const runtime = getRuntimeForAgent(agentId);
      if (runtime) {
        const health = getAgentHealth(agentId, runtime);
        agentHealths.push(health);
      }
    }

    const summary = generateHealthSummary(agentHealths);
    const needsAttention = getAgentsNeedingAttention(agentHealths).map((h) => h.agentId);

    const status: CloisterStatus = {
      running: this.isRunning(),
      lastCheck: this.lastCheck,
      config: this.config,
      summary,
      agentsNeedingAttention: needsAttention,
    };

    this._statusCache = status;
    this._statusCacheAt = now;
    return status;
  }

  /**
   * Get health for a specific agent
   */
  getAgentHealth(agentId: string): AgentHealth | null {
    const runtime = getRuntimeForAgent(agentId);
    if (!runtime) {
      return null;
    }

    return getAgentHealth(agentId, runtime);
  }

  /**
   * Get health for all running agents
   */
  getAllAgentHealth(): AgentHealth[] {
    const runningAgents = listRunningAgents().filter((a) => a.tmuxActive);
    const agentHealths: AgentHealth[] = [];

    for (const agent of runningAgents) {
      const runtime = getRuntimeForAgent(agent.id);
      if (runtime) {
        const health = getAgentHealth(agent.id, runtime);
        agentHealths.push(health);
      }
    }

    return agentHealths;
  }

  /**
   * Get deacon (specialist health monitor) status
   */
  getDeaconStatus() {
    return getDeaconStatus();
  }

  /**
   * Get the most recent patrol result (actions, cycle, timestamp)
   */
  getLastPatrolResult(): PatrolResult | null {
    return getLastPatrolResult();
  }

  /**
   * Get recent deacon log entries
   */
  getDeaconLogs(limit = 100): DeaconLogEntry[] {
    return getDeaconLogs(limit);
  }

  /**
   * Run a manual deacon patrol
   */
  async runDeaconPatrol(): Promise<PatrolResult> {
    return runPatrol();
  }

  /**
   * Check if deacon is running
   */
  isDeaconRunning(): boolean {
    return isDeaconRunning();
  }

  /**
   * Reload configuration
   */
  reloadConfig(): void {
    this.config = loadCloisterConfig();

    // Restart monitoring loop with new interval if running
    if (this.running && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.startMonitoringLoop();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: CloisterConfig): void {
    this.config = config;

    // Restart monitoring loop with new interval if running
    if (this.running && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.startMonitoringLoop();
    }
  }

  /**
   * Register an event listener
   */
  on(listener: CloisterEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Unregister an event listener
   */
  off(listener: CloisterEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: CloisterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Cloister event listener error:', error);
      }
    }
  }

  /**
   * Check if service is running
   *
   * Checks both local instance state and cross-process state file.
   * This allows the CLI to detect if Cloister is running in the dashboard process.
   */
  isRunning(): boolean {
    // First check our own instance
    if (this.running) {
      return true;
    }
    // Check if another process has Cloister running
    const stateFile = readStateFile();
    return stateFile.running;
  }
}

/**
 * Global Cloister service instance
 */
let globalService: CloisterService | null = null;

/**
 * Get the global Cloister service instance
 *
 * Creates a new instance if one doesn't exist.
 */
export function getCloisterService(): CloisterService {
  if (!globalService) {
    globalService = new CloisterService();
  }
  return globalService;
}

/**
 * Set the global Cloister service instance
 *
 * Useful for testing or custom configurations.
 */
export function setCloisterService(service: CloisterService): void {
  globalService = service;
}
