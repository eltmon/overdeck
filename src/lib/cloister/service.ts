/** Cloister service: core monitoring for all running agents. */
import { createHash } from 'crypto';
import type { AgentRuntimeSync, HealthState } from '../runtimes/types.js';
import { isContextOverflowTail, CONTEXT_OVERFLOW_TAIL_LINES } from '../context-overflow.js';
import type { CloisterConfig } from './config.js';
import type { AgentHealth, HealthSummary } from './health.js';
import type { DomainEvent } from '@overdeck/contracts';
import { loadCloisterConfigSync } from './config.js';
import {
  getAgentHealth,
  getMultipleAgentHealth,
  generateHealthSummary,
  getAgentsToPoke,
  getAgentsToKill,
  getAgentsNeedingAttention,
} from './health.js';
// PAN-378: initializeEnabledSpecialists removed — per-project ephemeral specialists
// are spawned on-demand, no global initialization needed.
import { getGlobalRegistry, getRuntimeForAgent } from '../runtimes/index.js';
import { listRunningAgentsSync, getAgentStateSync, getAgentRuntimeStateSync, saveAgentRuntimeState } from '../agents.js';
import {
  isCloisterSpawnsPausedSync,
  setCloisterSpawnsPausedSync,
  setDeaconGloballyPaused,
  setFlywheelGloballyPaused,
} from '../overdeck/control-settings.js';
import type { TriggerDetection } from './triggers.js';
import type { HandoffResult } from './handoff.js';
import {
  checkAgentForViolations,
  sendNudge,
  resolveViolationSync,
  hasExceededMaxNudges,
  type FPPViolation,
} from './fpp-violations.js';
import { checkCostLimits, getCostSummary, type CostAlert } from './cost-monitor.js';
import type { SessionRotationResult } from './session-rotation.js';
import {
  startDeacon,
  stopDeacon,
  isDeaconRunning,
  getDeaconStatus,
  assessDeaconPatrolFreshness,
  getLastPatrolResult,
  getDeaconLogs,
  runPatrol,
  type PatrolResult,
  type DeaconLogEntry,
} from './deacon.js';
import { OVERDECK_HOME } from '../paths.js';
import { existsSync, writeFileSync, unlinkSync, readFileSync, readdirSync, renameSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { AGENTS_DIR } from '../paths.js';
import { loadReviewStatuses, setReviewStatusSync } from '../review-status.js';
import { isRoleTerminal, type AdvancingRole } from './reap-terminal-sessions.js';
import { sessionExists } from '../tmux.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

const execAsync = promisify(exec);
import { emitActivityEntrySync } from '../activity-logger.js';
import { handleCloisterDomainEvent, identifyOrphanedReviewingIssues, parseSpecialistAgentSession } from './service-reactive.js';
import {
  checkHandoffTriggers,
  checkSpecialistRotations,
  mapHeartbeatSource,
  performHealthCheck,
  recordHealthEvent,
  type HealthEvent, type HealthHost,
} from './service-health.js';
import type { CloisterDomainEventLike } from './service-reactive.js';
export { spawnFlywheel, pauseFlywheel, resumeFlywheel } from './flywheel.js';
export {
  handleCloisterDomainEvent,
  identifyOrphanedReviewingIssues,
  issueStateChangeFromDomainEvent,
  onIssueStateChange,
  parseSpecialistAgentSession,
  stateToRole,
} from './service-reactive.js';
export type { CloisterDomainEventLike, ReactiveIssueState } from './service-reactive.js';

// State file for cross-process communication
const CLOISTER_STATE_FILE = join(OVERDECK_HOME, 'cloister.state');
const LEGACY_SPECIALISTS_DIR = join(OVERDECK_HOME, 'specialists');

async function cleanupLegacySpecialistsDirectory(): Promise<void> {
  await rm(LEGACY_SPECIALISTS_DIR, { recursive: true, force: true });
}

interface CloisterEventStore {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  subscribe?: (fn: (event: CloisterDomainEventLike) => void) => () => void;
}

let cloisterEventStoreProvider: (() => CloisterEventStore) | null = null;

export function setCloisterEventStoreProvider(provider: (() => CloisterEventStore) | null): void {
  cloisterEventStoreProvider = provider;
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
export function readCloisterStateFile(): { running: boolean; pid?: number; startedAt?: string } {
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
  patrol: ReturnType<typeof assessDeaconPatrolFreshness> & {
    loopRunning: boolean;
    patrolIntervalMs: number;
  };
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
 * One-shot convoy roles (PAN-1742). The review lenses + synthesis and the test
 * role are spawned fresh via `spawnRun` each cycle; they run once, write their
 * artifact, and exit. They never save a sessionId, so they cannot be resumed.
 */
const ONE_SHOT_ROLES: ReadonlySet<string> = new Set(['review', 'test']);

/**
 * Decide whether a vanished tmux session should be treated as a crash worth
 * auto-restarting (PAN-1742). Returns a human-readable reason to SKIP the
 * crash/restart machinery, or `null` when the agent is a genuine restart
 * candidate.
 *
 * Two cases are not crashes:
 *  - one-shot convoy roles, whose session-end is a normal completion; and
 *  - any agent without a saved session, which `restartAgent` cannot resume
 *    (it throws "No session ID found"), so counting a crash and scheduling a
 *    restart is pure noise.
 *
 * Pure and exported so the rule is unit-tested independent of the service's
 * private health-check plumbing.
 */
export function nonRestartableReason(role: string, sessionId: string | undefined): string | null {
  if (ONE_SHOT_ROLES.has(role)) {
    return `(${role}) finished its one-shot run — completion, not a crash`;
  }
  if (!sessionId) {
    return 'ended with no resumable session — not auto-restartable';
  }
  return null;
}

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
  // PAN-2452 (idle-alive): progress fingerprint at last poke → consecutive
  // ineffective-poke count. A poke that changes neither the workspace HEAD nor
  // the pane content did nothing; escalating beats poking forever.
  private pokeProgress: Map<string, { fingerprint: string; ineffective: number }> = new Map();
  private domainEventUnsubscribe: (() => void) | null = null;
  private eventStore: CloisterEventStore | null = null;

  // ─── Status cache ────────────────────────────────────────────────────────────
  // getStatus() does sync file I/O + tmux calls for every agent. Cache for 3s
  // to eliminate blocking on high-frequency dashboard polls.
  private _statusCache: CloisterStatus | null = null;
  private _statusCacheAt = 0;
  private readonly STATUS_CACHE_TTL_MS = 3_000;

  constructor(config?: CloisterConfig) {
    this.config = config || loadCloisterConfigSync();
  }

  private healthHost(): HealthHost {
    const service = this;
    return {
      get previousRunningAgents() { return service.previousRunningAgents; },
      set previousRunningAgents(value: Set<string>) { service.previousRunningAgents = value; },
      get config() { return service.config; },
      get healthCheckCount() { return service.healthCheckCount; },
      set healthCheckCount(value: number) { service.healthCheckCount = value; },
      get lastCheck() { return service.lastCheck; },
      set lastCheck(value: Date | null) { service.lastCheck = value; },
      get lastPokeTimestamps() { return service.lastPokeTimestamps; },
      get previousStates() { return service.previousStates; },
      handleAgentCrash: (agentId: string) => service.handleAgentCrash(agentId),
      checkCompletionMarkers: () => service.checkCompletionMarkers(),
      recordHealthEvent: (health: AgentHealth) => service.recordHealthEvent(health),
      emit: (event: HealthEvent) => service.emit(event),
      pokeAgent: (agentId: string) => service.pokeAgent(agentId),
      killAgent: (agentId: string) => service.killAgent(agentId),
      checkHandoffTriggers: (agentHealths: AgentHealth[]) => service.checkHandoffTriggers(agentHealths),
      checkFPPViolations: (agentIds: string[]) => service.checkFPPViolations(agentIds),
      checkCostAlerts: (agentIds: string[]) => service.checkCostAlerts(agentIds),
      checkSpecialistRotations: () => service.checkSpecialistRotations(),
      mapHeartbeatSource: (source: string) => service.mapHeartbeatSource(source),
    };
  }

  private getDashboardApiUrl(): string {
    // Cloister always runs in-process with the dashboard, so it must talk to
    // its own loopback — never to a public DASHBOARD_URL like https://overdeck.localhost,
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

    try {
      await cleanupLegacySpecialistsDirectory();
      console.log('  ✓ Removed legacy ~/.overdeck/specialists directory');
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
          setReviewStatusSync(issueId, { verificationStatus: 'pending' });
          console.log(`  ✓ Reset orphaned verification 'running' → 'pending' for ${issueId}`);
          resetVerificationCount++;
        }
      }
      if (resetVerificationCount > 0) {
        emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `Reset ${resetVerificationCount} orphaned verification 'running' → 'pending' on startup` });
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
          const runtimeState = getAgentRuntimeStateSync(entry.name);
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
              ? await Effect.runPromise(sessionExists(entry.name))
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
        emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `Cleared ${clearedSpecialistCount} stale specialist state(s) on startup` });
      }
    } catch (error) {
      console.error('  ✗ Failed to clear stale specialist states:', error);
    }

    // PAN-511: Startup recovery for orphaned reviewStatus='reviewing' issues.
    // If Cloister crashes after reviewStatus was set to 'reviewing' but before the specialist
    // completes, the issue is stuck. On startup, find such issues and re-dispatch directly.
    try {
      const reviewStatuses = loadReviewStatuses();
      const { resolveProjectFromIssueSync } = await import('../projects.js');
      const { getTmuxSessionName, getAllProjectSpecialistStatuses } = await import('./specialists.js');

      // Build set of issue IDs actively being reviewed by a running specialist
      const activeReviewIssues = new Set<string>();
      try {
        const projSpecs = await getAllProjectSpecialistStatuses();
        for (const ps of projSpecs) {
          if (ps.specialistType !== 'review-agent' || !ps.isRunning) continue;
          const rs = getAgentRuntimeStateSync(ps.tmuxSession);
          if (rs?.state === 'active' && rs.currentIssue) {
            activeReviewIssues.add(rs.currentIssue.toUpperCase());
          }
        }
        // Also check global review-agent session
        const globalSession = getTmuxSessionName('review-agent');
        const globalRs = getAgentRuntimeStateSync(globalSession);
        if (globalRs?.state === 'active' && globalRs.currentIssue) {
          activeReviewIssues.add(globalRs.currentIssue.toUpperCase());
        }

        // PAN-1048 R5: detect role-primitive review runs (agent-<id>-review).
        // Replaces the legacy getActiveParallelReviewIssues helper that scanned
        // tmux for dispatchParallelReview's coordinator session naming pattern.
        const { listRunningAgents } = await import('../agents.js');
        const agents = await Effect.runPromise(listRunningAgents());
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
        emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `Found ${orphanedReviewing.length} orphaned reviewStatus='reviewing' issue(s) on startup`, details: orphanedReviewing.join(', ') });

        for (const issueId of orphanedReviewing) {

          const agentId = `agent-${issueId.toLowerCase()}`;
          const agentState = getAgentStateSync(agentId);
          const workspace = agentState?.workspace;

          if (!workspace) {
            console.log(`  ⚠ ${issueId}: orphaned reviewing but no workspace found — resetting to pending`);
            setReviewStatusSync(issueId, { reviewStatus: 'pending' });
            emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `${issueId} orphaned reviewing reset to pending — no workspace found`, issueId });
            continue;
          }

          const resolved = resolveProjectFromIssueSync(issueId);
          if (!resolved) {
            console.log(`  ⚠ ${issueId}: orphaned reviewing but no project configured — resetting to pending`);
            setReviewStatusSync(issueId, { reviewStatus: 'pending' });
            emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `${issueId} orphaned reviewing reset to pending — no project configured`, issueId });
            continue;
          }

          const branch = `feature/${issueId.toLowerCase()}`;
          // PAN-1048 R4: startup recovery now spawns the review role primitive
          // (loads roles/review.md → Agent tool fans out to convoy reviewers)
          // instead of the legacy `pan review run` coordinator.
          const { spawnReviewRoleForIssue } = await import('./review-agent.js');
          const dispatchResult = await Effect.runPromise(spawnReviewRoleForIssue({ issueId, workspace, branch }));
          if (dispatchResult.gated) {
            console.log(`  → Deferred recovery review for ${issueId}: ${dispatchResult.message}`);
            emitActivityEntrySync({ source: 'cloister', level: 'info', message: `Deferred recovery review for ${issueId}: ${dispatchResult.message}`, issueId });
            continue;
          }
          if (!dispatchResult.success) {
            console.log(`  ⚠ Failed to re-dispatch recovery review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
            emitActivityEntrySync({ source: 'cloister', level: 'warn', message: `Failed to re-dispatch recovery review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`, issueId });
            continue;
          }
          // spawnReviewRoleForIssue sets reviewStatus='reviewing' internally
          console.log(`  ✓ Re-dispatched recovery review for ${issueId}`);
          emitActivityEntrySync({ source: 'cloister', level: 'info', message: `Re-dispatched recovery review for ${issueId}`, issueId });
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
      emitActivityEntrySync({ source: 'cloister', level: 'info', message: 'Deacon health monitor started' });
    } catch (error) {
      console.error('  ✗ Failed to start deacon:', error);
      emitActivityEntrySync({ source: 'cloister', level: 'error', message: `Failed to start deacon: ${error instanceof Error ? error.message : String(error)}` });
    }

    this.running = true;
    this.starting = false;
    this._statusCache = null;
    writeStateFile(true);
    this.emit({ type: 'started' });
    emitActivityEntrySync({ source: 'cloister', level: 'info', message: 'Cloister agent watchdog started' });

    await this.subscribeToDomainEvents();

    // Start monitoring loop
    this.startMonitoringLoop();
  }

  private async subscribeToDomainEvents(): Promise<void> {
    if (this.domainEventUnsubscribe) return;

    try {
      const injected = cloisterEventStoreProvider?.();
      if (injected) {
        this.eventStore = injected;
        if (injected.subscribe) {
          this.domainEventUnsubscribe = injected.subscribe((event) => {
            void Effect.runPromise(handleCloisterDomainEvent(event)).catch((error) => {
              console.error('[cloister] Reactive lifecycle event handling failed:', error);
              emitActivityEntrySync({
                source: 'cloister',
                level: 'error',
                message: `Reactive lifecycle event handling failed: ${error instanceof Error ? error.message : String(error)}`,
              });
            });
          });
        }
        console.log('  ✓ Cloister event store provider installed');
        return;
      }

      const { initEventStore } = await import('../../dashboard/server/event-store.js');
      const store = await initEventStore();
      this.eventStore = store;
      this.domainEventUnsubscribe = store.subscribe((event) => {
        void Effect.runPromise(handleCloisterDomainEvent(event)).catch((error) => {
          console.error('[cloister] Reactive lifecycle event handling failed:', error);
          emitActivityEntrySync({
            source: 'cloister',
            level: 'error',
            message: `Reactive lifecycle event handling failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      });
      console.log('  ✓ Cloister reactive lifecycle scheduler subscribed to domain events');
    } catch (error) {
      console.error('  ✗ Failed to subscribe Cloister reactive lifecycle scheduler:', error);
      emitActivityEntrySync({
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

    this.emit({ type: 'stopped' });
  }

  /**
   * Emergency stop - kill ALL agents immediately
   *
   * This is the nuclear option. Use with caution.
   */
  emergencyStop(): string[] {
    console.log('🚨 EMERGENCY STOP - Killing all agents');

    // Freeze auto-resume FIRST, before killing — otherwise the deacon patrol or a
    // dashboard restart re-spawns the agents we are about to kill and the money
    // keeps burning. This persists in SQLite, so the freeze survives a restart;
    // the operator clears it explicitly (Deacon resume / flywheel resume) when
    // they are ready to let agents run again.
    try {
      setDeaconGloballyPaused(true);
      setFlywheelGloballyPaused(true);
      console.log('  ✓ Froze Deacon + flywheel auto-resume');
    } catch (error) {
      console.error('  ✗ Failed to set global pause flags:', error);
    }

    const runningAgents = listRunningAgentsSync();
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
    return performHealthCheck(this.healthHost());
  }

  /** Fallback scan for completion markers when `pan done` did not reach the dashboard. */
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

        // A stale `.processed` from a prior round must not block a fresh completion.
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

        // Check retry count; reset stale in-memory counters for fresh completions.
        const retryCount = this.processedCompletions.get(dir.name) || 0;
        if (retryCount === Infinity) {
          this.processedCompletions.delete(dir.name);
        } else if (retryCount >= 3) continue;

        // Extract issue ID from agent dir name (e.g. "agent-pan-123" → "PAN-123")
        const issueId = dir.name.replace('agent-', '').toUpperCase();

        // Skip if `pan done` already triggered review.
        const { getReviewStatusSync } = await import('../review-status.js');
        const existingReview = getReviewStatusSync(issueId);
        if (existingReview && ['reviewing', 'passed'].includes(existingReview.reviewStatus || '')) {
          console.log(`🔔 Cloister: Completion marker for ${issueId} — review already ${existingReview.reviewStatus}, marking processed`);
          try { renameSync(completedFile, processedFile); } catch {}
          this.processedCompletions.set(dir.name, Infinity);
          continue;
        }

        console.log(`🔔 Cloister: Found completion marker for ${issueId}, triggering review...${retryCount > 0 ? ` (retry ${retryCount}/3)` : ''}`);

        try {
          // Use fetch() so https dashboard URLs work.
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
    // Fire-and-forget wrapper; the async body measures progress first.
    void this.pokeAgentWithEscalation(agentId).catch((error) => {
      console.error(`Failed to poke ${agentId}:`, error);
    });
  }

  /** PAN-2452: fingerprint of observable progress — workspace HEAD + pane tail.
   * Unchanged fingerprint across pokes = the poke did nothing. */
  private async progressFingerprint(agentId: string): Promise<string> {
    const state = getAgentStateSync(agentId);
    let head = '';
    if (state?.workspace) {
      try {
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: state.workspace, encoding: 'utf-8' });
        head = stdout.trim();
      } catch { /* workspace may be gone; pane still fingerprints */ }
    }
    let pane = '';
    try {
      const { stdout } = await execAsync(
        `tmux -L overdeck capture-pane -t ${JSON.stringify(agentId)} -p -S -${CONTEXT_OVERFLOW_TAIL_LINES}`,
        { encoding: 'utf-8' },
      );
      pane = stdout;
    } catch { /* session may be gone */ }
    const paneHash = createHash('sha1').update(pane).digest('hex').slice(0, 12);
    return `${head}:${paneHash}`;
  }

  private async pokeAgentWithEscalation(agentId: string): Promise<void> {
    const runtime = getRuntimeForAgent(agentId);
    if (!runtime) {
      throw new Error(`No runtime found for agent ${agentId}`);
    }

    const fingerprint = await this.progressFingerprint(agentId);
    const prior = this.pokeProgress.get(agentId);
    const ineffective = prior && prior.fingerprint === fingerprint ? prior.ineffective + 1 : 0;
    this.pokeProgress.set(agentId, { fingerprint, ineffective });

    // Tier 3 (5th no-progress poke): stop poking — surface to the operator.
    if (ineffective >= 4) {
      const { setAgentPausedSync } = await import('../agents/agent-state.js');
      try {
        setAgentPausedSync(agentId, `needs-you: idle-alive — no observable progress across ${ineffective + 1} pokes (idle-alive escalation)`);
        this.emit({ type: 'agent_stuck', agentId, health: undefined as never });
        console.log(`🛑 ${agentId} paused: idle-alive across ${ineffective + 1} pokes`);
      } catch (pauseErr) {
        console.error(`Failed to pause idle-alive ${agentId}:`, pauseErr);
      }
      return;
    }

    // Tier 2 (3rd no-progress poke): escalate — /compact on overflow, else a
    // substantive reconstruct instruction instead of another "are you stuck?".
    let pokeMessage =
      'Hey, I noticed you haven\'t made progress in a while. Are you stuck? ' +
      'If you need help or clarification, please ask. Otherwise, please continue with your work.';
    if (ineffective >= 2) {
      let tail = '';
      try {
        const { stdout } = await execAsync(
          `tmux -L overdeck capture-pane -t ${JSON.stringify(agentId)} -p -S -${CONTEXT_OVERFLOW_TAIL_LINES}`,
          { encoding: 'utf-8' },
        );
        tail = stdout;
      } catch { /* fall through to reconstruct nudge */ }
      if (isContextOverflowTail(tail)) {
        pokeMessage = '/compact';
        console.log(`🔔 ${agentId}: overflow tail detected — delivering /compact instead of a poke`);
      } else {
        pokeMessage =
          'You appear active but have made no observable progress (no new commits, unchanged output) across multiple checks. '
          + 'Do exactly one of: (1) work is done — commit, push, and run pan done; '
          + '(2) blocked — state the blocker in one sentence and commit what you have as WIP; '
          + '(3) lost context — re-read your bead (bd show), your latest .pan/feedback/ file, and git status, then resume. Act now.';
      }
    }

    await Promise.resolve(runtime.sendMessage(agentId, pokeMessage)).catch((sendErr) => {
      console.error(`Failed to send poke to ${agentId}:`, sendErr);
    });
    this.emit({ type: 'poked_agent', agentId });
    console.log(`🔔 Poked ${agentId}${ineffective > 0 ? ` (ineffective streak: ${ineffective})` : ''}`);
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
    const agentState = getAgentStateSync(agentId);
    if (!agentState || agentState.status === 'stopped') {
      console.log(`🔔 Agent ${agentId} was intentionally stopped, skipping restart`);
      return;
    }
    const runtimeState = getAgentRuntimeStateSync(agentId);
    if (runtimeState?.state === 'suspended') {
      console.log(`🔔 Agent ${agentId} is suspended, skipping restart`);
      return;
    }
    if (runtimeState?.state === 'stopped') {
      console.log(`🔔 Agent ${agentId} runtime is stopped, skipping restart`);
      return;
    }

    // PAN-1742: a vanished session is not always a crash. One-shot convoy roles
    // complete-and-exit, and any agent with no saved session is structurally
    // un-restartable. Either way, counting it as a crash pollutes the
    // crash/troubled counters and schedules a doomed restart.
    const skipReason = nonRestartableReason(agentState.role, agentState.sessionId);
    if (skipReason) {
      // PAN-2007: a one-shot review/test session that vanished BEFORE recording a
      // terminal verdict died prematurely — e.g. before it could run
      // `pan specialists done`. Masking that as a normal "one-shot completion" and
      // skipping restart strands the issue at reviewStatus=reviewing forever (the
      // exact PAN-1832 symptom). Recover it instead: resume so it can finish and
      // signal. Only a terminal verdict (or a missing session) is a genuine
      // non-restartable completion.
      let recoverUnfinishedOneShot = false;
      if (ONE_SHOT_ROLES.has(agentState.role) && agentState.sessionId && agentState.issueId) {
        try {
          const { getReviewStatusSync } = await import('../review-status.js');
          const status = getReviewStatusSync(agentState.issueId);
          const verdictTerminal = status
            ? isRoleTerminal(agentState.role as AdvancingRole, {
                reviewStatus: status.reviewStatus,
                testStatus: status.testStatus,
                readyForMerge: status.readyForMerge,
                mergeStatus: status.mergeStatus,
              })
            : false;
          recoverUnfinishedOneShot = !verdictTerminal;
        } catch {
          recoverUnfinishedOneShot = false;
        }
      }
      if (!recoverUnfinishedOneShot) {
        console.log(`🔔 Agent ${agentId} ${skipReason}; skipping restart`);
        return;
      }
      console.log(`🔔 Agent ${agentId} (${agentState.role}) vanished before a terminal verdict — recovering instead of treating as a one-shot completion (PAN-2007)`);
      // fall through to the restart/resume path below
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

    // PAN-1908: emit agent.heartbeat_dead so the event-driven deacon recovery
    // can mark the agent stopped and resume it with the proper gates, rather
    // than Cloister scheduling its own auto-restart in parallel.
    if (this.eventStore) {
      try {
        this.eventStore.append({
          type: 'agent.heartbeat_dead',
          timestamp: new Date().toISOString(),
          payload: { agentId, issueId: agentState.issueId, sessionId: agentState.sessionId },
        });
      } catch (err) {
        console.error(`[cloister] Failed to emit heartbeat_dead for ${agentId}:`, err);
      }
    }

    // Check if we've exceeded max retries
    if (tracker.crashCount > config.max_retries) {
      tracker.gaveUp = true;
      this.emit({ type: 'agent_gave_up', agentId, maxRetries: config.max_retries });
      console.error(`🔔 Gave up on restarting ${agentId} after ${config.max_retries} attempts`);
      return;
    }

    // Calculate backoff delay for logging/mass-death tracking only — the actual
    // resume is handled by the deacon's agent.heartbeat_dead handler.
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
      `🔔 Deacon will recover ${agentId} via heartbeat_dead (attempt ${tracker.crashCount}/${config.max_retries}, backoff ${backoffSeconds}s)`
    );
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
    const agentState = getAgentStateSync(agentId);
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
    setCloisterSpawnsPausedSync(true);
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
    setCloisterSpawnsPausedSync(false);
    this.deathTimestamps = []; // Clear death window
    this.emit({ type: 'spawn_resumed' });
    console.log(`🔔 Agent spawns resumed`);
  }

  /**
   * Check if spawns are currently paused
   */
  isSpawnPaused(): boolean {
    return this.spawnsPaused || isCloisterSpawnsPausedSync();
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

        // Resolve the entity label: for daily_total, use explicit "(unattributed)" bucket
        const entityLabel = alert.agentId || alert.issueId || '(unattributed)';

        // Log the alert
        if (alert.level === 'limit_reached') {
          console.error(
            `🔔 COST LIMIT REACHED: ${alert.type} for ${entityLabel} - $${alert.currentCost.toFixed(2)} / $${alert.limit.toFixed(2)}`
          );
        } else {
          console.warn(
            `🔔 Cost warning: ${alert.type} for ${entityLabel} at ${alert.percentUsed.toFixed(0)}% ($${alert.currentCost.toFixed(2)} / $${alert.limit.toFixed(2)})`
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
    return checkSpecialistRotations(this.healthHost());
  }

  /**
   * Record health event to database
   *
   * Only writes events when state changes or on first check.
   */
  private recordHealthEvent(health: AgentHealth): void {
    return recordHealthEvent(this.healthHost(), health);
  }

  /**
   * Check for handoff triggers and execute handoffs (Phase 4)
   *
   * Checks all triggers for each agent and performs handoffs when triggered.
   */
  private async checkHandoffTriggers(agentHealths: AgentHealth[]): Promise<void> {
    return checkHandoffTriggers(this.healthHost(), agentHealths);
  }

  /**
   * Map heartbeat source to database source string
   */
  private mapHeartbeatSource(source: string): string {
    return mapHeartbeatSource(this.healthHost(), source);
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

    const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
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

    const deaconStatus = getDeaconStatus();
    const patrol = assessDeaconPatrolFreshness({
      isRunning: deaconStatus.isRunning,
      lastPatrol: deaconStatus.state.lastPatrol,
      patrolIntervalMs: deaconStatus.config.patrolIntervalMs,
    });

    const status: CloisterStatus = {
      running: this.isRunning(),
      lastCheck: this.lastCheck,
      config: this.config,
      summary,
      agentsNeedingAttention: needsAttention,
      patrol: {
        ...patrol,
        loopRunning: deaconStatus.isRunning,
        patrolIntervalMs: deaconStatus.config.patrolIntervalMs,
      },
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
    const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
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
    this.config = loadCloisterConfigSync();

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
    const stateFile = readCloisterStateFile();
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
