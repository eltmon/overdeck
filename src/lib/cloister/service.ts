/** Cloister service: core monitoring for all running agents. */
import type { HealthState } from '../runtimes/types.js';
import type { CloisterConfig } from './config.js';
import type { AgentHealth } from './health.js';
import type { DomainEvent } from '@overdeck/contracts';
import { loadCloisterConfigSync } from './config.js';
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
import type { FPPViolation } from './fpp-violations.js';
import { getCostSummary, type CostAlert } from './cost-monitor.js';
import type { SessionRotationResult } from './session-rotation.js';
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
import { OVERDECK_HOME } from '../paths.js';
import { existsSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { AGENTS_DIR } from '../paths.js';
import { loadReviewStatuses, setReviewStatusSync } from '../review-status.js';
import { sessionExists } from '../tmux.js';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { handleCloisterDomainEvent, identifyOrphanedReviewingIssues, parseSpecialistAgentSession } from './service-reactive.js';
import {
  checkHandoffTriggers,
  checkCostAlerts,
  checkFPPViolations,
  checkSpecialistRotations,
  mapHeartbeatSource,
  performHealthCheck,
  recordHealthEvent,
  type HealthEvent, type HealthHost,
} from './service-health.js';
import { checkCompletionMarkers, type CompletionHost } from './service-completion.js';
import { checkForMassDeaths as checkForMassDeathsWithHost, handleAgentCrash as handleAgentCrashWithHost, killAgent as killAgentWithHost, pauseSpawns as pauseSpawnsWithHost, pokeAgent as pokeAgentWithHost, pokeAgentWithEscalation as pokeAgentWithEscalationWithHost, progressFingerprint as progressFingerprintWithHost, restartAgent as restartAgentWithHost, type CrashEvent, type CrashHost } from './service-crash.js';
import { getAllAgentHealth as getAllAgentHealthWithHost, getServiceAgentHealth, getStatus as getStatusWithHost, type CloisterStatus, type StatusHost } from './service-status.js';
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
export type { CloisterStatus } from './service-status.js';
export { nonRestartableReason } from './service-crash.js';

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
      get pokeProgress() { return service.pokeProgress; },
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

  private completionHost(): CompletionHost {
    const service = this;
    return {
      get processedCompletions() { return service.processedCompletions; },
      getDashboardApiUrl: () => service.getDashboardApiUrl(),
    };
  }

  private crashHost(): CrashHost {
    const service = this;
    return {
      get config() { return service.config; },
      get crashTrackers() { return service.crashTrackers; },
      get deathTimestamps() { return service.deathTimestamps; },
      set deathTimestamps(value: Date[]) { service.deathTimestamps = value; },
      get spawnsPaused() { return service.spawnsPaused; },
      set spawnsPaused(value: boolean) { service.spawnsPaused = value; },
      get pokeProgress() { return service.pokeProgress; },
      get eventStore() { return service.eventStore; },
      progressFingerprint: (agentId: string) => service.progressFingerprint(agentId),
      pokeAgentWithEscalation: (agentId: string) => service.pokeAgentWithEscalation(agentId),
      checkForMassDeaths: () => service.checkForMassDeaths(),
      pauseSpawns: (reason: string) => service.pauseSpawns(reason),
      emit: (event: CrashEvent) => service.emit(event),
    };
  }

  private statusHost(): StatusHost {
    const service = this;
    return {
      get statusCache() { return service._statusCache; },
      set statusCache(value: CloisterStatus | null) { service._statusCache = value; },
      get statusCacheAt() { return service._statusCacheAt; },
      set statusCacheAt(value: number) { service._statusCacheAt = value; },
      get statusCacheTtlMs() { return service.STATUS_CACHE_TTL_MS; },
      get lastCheck() { return service.lastCheck; },
      get config() { return service.config; },
      isRunning: () => service.isRunning(),
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
    return checkCompletionMarkers(this.completionHost());
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
    return pokeAgentWithHost(this.crashHost(), agentId);
  }

  /** PAN-2452: fingerprint of observable progress — workspace HEAD + pane tail.
   * Unchanged fingerprint across pokes = the poke did nothing. */
  private async progressFingerprint(agentId: string): Promise<string> {
    return progressFingerprintWithHost(this.crashHost(), agentId);
  }

  private async pokeAgentWithEscalation(agentId: string): Promise<void> {
    return pokeAgentWithEscalationWithHost(this.crashHost(), agentId);
  }

  /**
   * Kill an agent
   *
   * runtime.killAgent() is also async in some runtime implementations — apply
   * the same fire-and-forget guard as pokeAgent so async rejection cannot
   * crash the dashboard from a deacon health-check timer callback.
   */
  private killAgent(agentId: string): void {
    return killAgentWithHost(this.crashHost(), agentId);
  }

  /**
   * Handle agent crash with auto-restart logic
   */
  private async handleAgentCrash(agentId: string): Promise<void> {
    return handleAgentCrashWithHost(this.crashHost(), agentId);
  }

  /**
   * Restart an agent using its saved session
   */
  private async restartAgent(agentId: string): Promise<void> {
    return restartAgentWithHost(this.crashHost(), agentId);
  }

  /**
   * Check for mass death events
   *
   * Detects when 3+ agents die within 30 seconds and pauses spawns.
   */
  private checkForMassDeaths(): void {
    return checkForMassDeathsWithHost(this.crashHost());
  }

  /**
   * Pause new agent spawns
   */
  private pauseSpawns(reason: string): void {
    return pauseSpawnsWithHost(this.crashHost(), reason);
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
    return checkFPPViolations(this.healthHost(), agentIds);
  }

  /**
   * Check for cost limit alerts
   */
  private checkCostAlerts(agentIds: string[]): void {
    return checkCostAlerts(this.healthHost(), agentIds);
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
    return getStatusWithHost(this.statusHost());
  }

  /**
   * Get health for a specific agent
   */
  getAgentHealth(agentId: string): AgentHealth | null {
    return getServiceAgentHealth(this.statusHost(), agentId);
  }

  /**
   * Get health for all running agents
   */
  getAllAgentHealth(): AgentHealth[] {
    return getAllAgentHealthWithHost(this.statusHost());
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
