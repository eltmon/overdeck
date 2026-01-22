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
      await this.checkHandoffTriggers(agentHealths);
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
      running: this.running,
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
   */
  isRunning(): boolean {
    return this.running;
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
