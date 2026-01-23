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
  initHealthDatabase,
  writeHealthEvent,
  getLatestHealthEvent,
  closeHealthDatabase,
} from './database.js';
import { initializeEnabledSpecialists } from './specialists.js';
import { getGlobalRegistry, getRuntimeForAgent } from '../runtimes/index.js';
import { listRunningAgents, getAgentState } from '../agents.js';
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
import { PANOPTICON_HOME } from '../paths.js';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

// State file for cross-process communication
const CLOISTER_STATE_FILE = join(PANOPTICON_HOME, 'cloister.state');

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
  private checkInterval: NodeJS.Timeout | null = null;
  private lastCheck: Date | null = null;
  private config: CloisterConfig;
  private listeners: CloisterEventListener[] = [];
  private previousStates: Map<string, HealthState> = new Map();
  private crashTrackers: Map<string, AgentCrashTracker> = new Map();
  private previousRunningAgents: Set<string> = new Set();
  private deathTimestamps: Date[] = []; // Rolling window of agent death times
  private spawnsPaused: boolean = false;

  constructor(config?: CloisterConfig) {
    this.config = config || loadCloisterConfig();
  }

  /**
   * Start the Cloister service
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('Cloister is already running');
      return;
    }

    console.log('🔔 Starting Cloister agent watchdog...');

    // Initialize health history database
    try {
      initHealthDatabase();
      console.log('  ✓ Health history database initialized');
    } catch (error) {
      console.error('  ✗ Failed to initialize health database:', error);
    }

    // Auto-initialize enabled specialists
    try {
      console.log('  → Checking specialists...');
      const results = await initializeEnabledSpecialists();
      for (const result of results) {
        if (result.success) {
          console.log(`    ✓ ${result.name}: ${result.message}`);
        } else {
          console.log(`    ✗ ${result.name}: ${result.message}`);
        }
      }
    } catch (error) {
      console.error('  ✗ Failed to initialize specialists:', error);
    }

    this.running = true;
    writeStateFile(true);
    this.emit({ type: 'started' });

    // Start monitoring loop
    this.startMonitoringLoop();
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
    writeStateFile(false);

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Close database connection
    try {
      closeHealthDatabase();
    } catch (error) {
      console.error('Failed to close health database:', error);
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
            runtime.killAgent(agent.id);
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

      for (const health of needsAttention) {
        if (health.state === 'warning') {
          this.emit({ type: 'agent_warning', agentId: health.agentId, health });

          // Auto-poke if configured
          if (this.config.auto_actions.poke_on_warning) {
            this.pokeAgent(health.agentId);
          }
        } else if (health.state === 'stuck') {
          this.emit({ type: 'agent_stuck', agentId: health.agentId, health });

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
   * Poke an agent (send "are you stuck?" message)
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

      runtime.sendMessage(agentId, pokeMessage);
      this.emit({ type: 'poked_agent', agentId });

      console.log(`🔔 Poked ${agentId}`);
    } catch (error) {
      console.error(`Failed to poke ${agentId}:`, error);
    }
  }

  /**
   * Kill an agent
   */
  private killAgent(agentId: string): void {
    try {
      const runtime = getRuntimeForAgent(agentId);
      if (!runtime) {
        throw new Error(`No runtime found for agent ${agentId}`);
      }

      runtime.killAgent(agentId);
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
      } catch (error: any) {
        this.emit({
          type: 'agent_restart_failed',
          agentId,
          crashCount: tracker!.crashCount,
          error: error.message,
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
          ? this.mapActivitySource(health.heartbeat.source)
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
        const triggers = checkAllTriggers(
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
   * Map ActivitySource to database source string
   */
  private mapActivitySource(source: string): string {
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
   */
  getStatus(): CloisterStatus {
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

    return {
      running: this.isRunning(),
      lastCheck: this.lastCheck,
      config: this.config,
      summary,
      agentsNeedingAttention: needsAttention,
    };
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
