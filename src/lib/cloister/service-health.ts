/** Cloister health monitoring seam. */
import { Effect } from 'effect';
import { getAgentStateSync, listRunningAgentsSync } from '../agents.js';
import { getRuntimeForAgent } from '../runtimes/index.js';
import type { HealthState } from '../runtimes/types.js';
import { writeHealthEvent } from '../overdeck/health-events.js';
import type { CloisterConfig } from './config.js';
import {
  checkAgentForViolations,
  clearOldViolationsSync,
  hasExceededMaxNudges,
  sendNudge,
  type FPPViolation,
} from './fpp-violations.js';
import { checkCostLimits, type CostAlert } from './cost-monitor.js';
import { performHandoff } from './handoff.js';
import { createHandoffEvent, logHandoffEventSync } from './handoff-logger.js';
import { getAgentHealth, getAgentsNeedingAttention, type AgentHealth } from './health.js';
import { reconcilePiCostEventsForRunningAgents } from './pi-cost-reconciler.js';
import { checkAndRotateIfNeeded, type SessionRotationResult } from './session-rotation.js';
import { checkAllTriggers } from './triggers.js';
import type { TriggerDetection } from './triggers.js';
import type { HandoffResult } from './handoff.js';

export type HealthEvent =
  | { type: 'health_check'; agentHealths: AgentHealth[] }
  | { type: 'agent_warning'; agentId: string; health: AgentHealth }
  | { type: 'agent_stuck'; agentId: string; health: AgentHealth }
  | { type: 'session_rotated'; specialistName: string; result: SessionRotationResult }
  | { type: 'handoff_triggered'; agentId: string; trigger: TriggerDetection }
  | { type: 'handoff_completed'; agentId: string; result: HandoffResult }
  | { type: 'fpp_violation_detected'; agentId: string; violation: FPPViolation }
  | { type: 'fpp_nudge_sent'; agentId: string; nudgeCount: number }
  | { type: 'fpp_max_nudges_exceeded'; agentId: string; violation: FPPViolation }
  | { type: 'cost_alert'; alert: CostAlert }
  | { type: 'error'; error: Error };

export interface HealthHost {
  previousRunningAgents: Set<string>;
  config: CloisterConfig;
  healthCheckCount: number;
  lastCheck: Date | null;
  lastPokeTimestamps: Map<string, number>;
  pokeProgress: Map<string, { fingerprint: string; ineffective: number }>;
  previousStates: Map<string, HealthState>;
  /** cost-alert keys (`type:entity:level`) already alerted — see checkCostAlerts */
  activeCostAlertKeys: Set<string>;
  handleAgentCrash(agentId: string): Promise<void>;
  checkCompletionMarkers(): Promise<void>;
  recordHealthEvent(health: AgentHealth): void;
  emit(event: HealthEvent): void;
  pokeAgent(agentId: string): void;
  killAgent(agentId: string): void;
  checkHandoffTriggers(agentHealths: AgentHealth[]): Promise<void>;
  checkFPPViolations(agentIds: string[]): void;
  checkCostAlerts(agentIds: string[]): void;
  checkSpecialistRotations(): Promise<void>;
  mapHeartbeatSource(source: string): string;
}

/**
 * Perform a health check on all running agents
 */
export async function performHealthCheck(host: HealthHost): Promise<void> {
    try {
      const runningAgents = listRunningAgentsSync().filter((a) => a.tmuxActive);
      const agentIds = runningAgents.map((a) => a.id);
      const currentRunningSet = new Set(agentIds);

      // Detect crashed agents (were running before, not running now)
      if (host.previousRunningAgents.size > 0 && host.config.auto_restart?.enabled) {
        for (const previousAgentId of host.previousRunningAgents) {
          if (!currentRunningSet.has(previousAgentId)) {
            // Agent crashed!
            await host.handleAgentCrash(previousAgentId);
          }
        }
      }

      // Update the set of running agents for next check
      host.previousRunningAgents = currentRunningSet;

      // Completion marker check runs regardless of active agents —
      // completed agents won't have tmux sessions anymore
      host.healthCheckCount++;
      if (host.healthCheckCount % 4 === 0) {
        void host.checkCompletionMarkers();
      }

      if (agentIds.length === 0) {
        host.lastCheck = new Date();
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
          host.recordHealthEvent(health);
        }
      }

      host.lastCheck = new Date();
      host.emit({ type: 'health_check', agentHealths });

      // Check for agents needing attention
      const needsAttention = getAgentsNeedingAttention(agentHealths);

      const pokeCooldownMs = host.config.auto_actions.poke_cooldown_ms ?? 30 * 60 * 1000;
      const now = Date.now();

      for (const health of needsAttention) {
        // The sequencer is a long-lived singleton that is SUPPOSED to sit idle
        // between ranking passes — "no progress in a while" is its normal resting
        // state, not a stall. Never poke or kill it (it was spamming itself with
        // "are you stuck?" nudges every cooldown). Health is still recorded above;
        // only the attention/poke/kill action is skipped.
        const idleAgentState = getAgentStateSync(health.agentId);
        if (idleAgentState?.role === 'sequencer') continue;

        // Warm-idle on a pipeline-owned issue is expected, not a stall.
        const { shouldSkipIdlePokeForAgent } = await import('./stuck-remediation.js');
        if (shouldSkipIdlePokeForAgent(idleAgentState)) {
          host.pokeProgress.delete(health.agentId);
          continue;
        }

        const lastPoke = host.lastPokeTimestamps.get(health.agentId) ?? 0;
        const cooledDown = (now - lastPoke) >= pokeCooldownMs;

        if (health.state === 'warning') {
          host.emit({ type: 'agent_warning', agentId: health.agentId, health });

          // Auto-poke if configured and cooldown elapsed
          if (host.config.auto_actions.poke_on_warning && cooledDown) {
            host.pokeAgent(health.agentId);
            host.lastPokeTimestamps.set(health.agentId, now);
          }
        } else if (health.state === 'stuck') {
          host.emit({ type: 'agent_stuck', agentId: health.agentId, health });

          // Auto-poke stuck agents if configured and cooldown elapsed
          if ((host.config.auto_actions.poke_on_stuck ?? true) && cooledDown) {
            host.pokeAgent(health.agentId);
            host.lastPokeTimestamps.set(health.agentId, now);
          }

          // Auto-kill if configured (dangerous!)
          if (host.config.auto_actions.kill_on_stuck) {
            host.killAgent(health.agentId);
          }
        }
      }

      // Check for handoff triggers (Phase 4)
      // Note: Intentionally not awaiting - runs in background
      void host.checkHandoffTriggers(agentHealths);

      // Check for FPP violations (Phase 6)
      host.checkFPPViolations(agentIds);

      await reconcilePiCostEventsForRunningAgents(runningAgents);

      // Check cost limits (Phase 6)
      host.checkCostAlerts(agentIds);

      // Check for specialist session rotation needs (Phase 6)
      // Only check periodically (every ~10 checks)
      if (Math.random() < 0.1) {
        void host.checkSpecialistRotations();
      }

      // Clean up old resolved violations (daily)
      if (Math.random() < 0.01) {
        // ~1% chance each check = roughly once per day
        clearOldViolationsSync(24);
      }
    } catch (error) {
      console.error('Cloister health check failed:', error);
      host.emit({ type: 'error', error: error as Error });
    }

}

/**
 * Check if any specialists need session rotation
 */
export async function checkSpecialistRotations(host: HealthHost): Promise<void> {
    // Check merge-agent (the main candidate for rotation)
    const mergeAgentResult = await Effect.runPromise(checkAndRotateIfNeeded('merge-agent', process.cwd()));
    if (mergeAgentResult) {
      host.emit({ type: 'session_rotated', specialistName: 'merge-agent', result: mergeAgentResult });

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
export function recordHealthEvent(host: HealthHost, health: AgentHealth): void {
    try {
      const currentState = health.state;
      const previousState = host.previousStates.get(health.agentId);

      // Only write event if state changed or this is first check
      if (previousState === undefined || previousState !== currentState) {
        // Determine source from heartbeat
        const source = health.heartbeat?.source
          ? host.mapHeartbeatSource(health.heartbeat.source)
          : 'unknown';

        writeHealthEvent({
          agentId: health.agentId,
          timestamp: new Date().toISOString(),
          state: currentState,
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
        host.previousStates.set(health.agentId, currentState);
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
export async function checkHandoffTriggers(host: HealthHost, agentHealths: AgentHealth[]): Promise<void> {
    for (const health of agentHealths) {
      try {
        // Get agent state
        const agentState = getAgentStateSync(health.agentId);
        if (!agentState) continue;

        // Skip if no workspace (can't determine context)
        if (!agentState.workspace) continue;

        // Check all triggers
        const triggers = await Effect.runPromise(checkAllTriggers(
          health.agentId,
          agentState.workspace,
          agentState.issueId,
          agentState.model,
          health,
          host.config
        ));

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

          host.emit({ type: 'handoff_triggered', agentId: health.agentId, trigger });

          console.log(`🔔 Handoff triggered for ${health.agentId}: ${trigger.reason}`);

          // Perform handoff
          const result = await Effect.runPromise(performHandoff(health.agentId, {
            targetModel: trigger.suggestedModel || 'sonnet',
            reason: trigger.reason,
          }));

          host.emit({ type: 'handoff_completed', agentId: health.agentId, result });

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
            logHandoffEventSync(event);
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
 * Check for FPP violations and send nudges
 */
export function checkFPPViolations(host: HealthHost, agentIds: string[]): void {
    for (const agentId of agentIds) {
      const violation = checkAgentForViolations(agentId);
      if (!violation) continue;

      // New violation detected
      if (violation.nudgeCount === 0) {
        host.emit({ type: 'fpp_violation_detected', agentId, violation });
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
          host.emit({ type: 'fpp_max_nudges_exceeded', agentId, violation });
          console.error(
            `🔔 Agent ${agentId} exceeded max nudges for ${violation.type} - manual intervention required`
          );
        } else {
          // Send nudge
          const sent = sendNudge(violation);
          if (sent) {
            host.emit({ type: 'fpp_nudge_sent', agentId, nudgeCount: violation.nudgeCount });
          }
        }
      }
    }

}

/**
 * Check for cost limit alerts.
 *
 * Each alert fires once per threshold crossing, not on every sweep — the
 * un-deduped shape wrote the same "COST LIMIT REACHED" line hundreds of
 * thousands of times (480k+ lines in one dashboard.log). Keys are cleared
 * when the alert stops firing so a fresh crossing alerts again.
 */
export function checkCostAlerts(host: HealthHost, agentIds: string[]): void {
    const config = host.config.cost_limits;
    if (!config) return;

    const active = host.activeCostAlertKeys;
    const firing = new Set<string>();

    for (const agentId of agentIds) {
      // Extract issue ID from agent ID (format: agent-issue-123 or issue-123)
      const issueId = agentId.startsWith('agent-')
        ? agentId.replace(/^agent-/, '')
        : agentId;

      const alerts = checkCostLimits(agentId, issueId, config);
      for (const alert of alerts) {
        // Resolve the entity label: for daily_total, use explicit "(unattributed)" bucket
        const entityLabel = alert.agentId || alert.issueId || '(unattributed)';

        const key = `${alert.type}:${entityLabel}:${alert.level}`;
        firing.add(key);
        if (active.has(key)) continue; // already alerted this crossing
        active.add(key);

        host.emit({ type: 'cost_alert', alert });

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

    // Drop keys that stopped firing so the next crossing re-alerts.
    for (const key of active) {
      if (!firing.has(key)) active.delete(key);
    }
}

/**
 * Map heartbeat source to database source string
 */
export function mapHeartbeatSource(_host: HealthHost, source: string): string {
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
