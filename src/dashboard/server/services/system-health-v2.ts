import type {
  AgentHealthSnapshot,
  AgentRuntimeSnapshot,
  HealthReason,
  HealthState,
  ServiceHealthSnapshot,
  SpecialistLifecycle,
  SystemHealthSnapshot,
} from '@overdeck/contracts';

import {
  classifyAdvancingSessionLifecycle,
  type WarmIdleStatusShape,
} from '../../../lib/cloister/review-status-source.js';
import type { AgentHealthRuntimeState } from '../../../lib/agents/health.js';
import type {
  HostMetricSample,
  HostMetricSignal,
} from '../../../lib/system-health/types.js';

export type SystemHealthSeverity = 'normal' | 'warning' | 'critical';

export interface SmeeRelayHealthEvidence {
  status: 'not_configured' | 'running' | 'stopped' | 'unknown';
  message: string;
}

export function runtimeHealthState(
  runtime: AgentRuntimeSnapshot | null,
): AgentHealthRuntimeState | null {
  if (!runtime) return null;
  switch (runtime.activity) {
    case 'working':
    case 'thinking':
      return {
        state: 'active',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'waiting':
      return {
        state: 'waiting-on-human',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'idle':
      return {
        state: 'idle',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'stopped':
      return {
        state: 'stopped',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
  }
}

export function agentLifecycle(
  role: string | undefined,
  issueId: string,
  tmuxActive: boolean,
  statuses: ReadonlyMap<string, WarmIdleStatusShape>,
): SpecialistLifecycle {
  if (role !== 'review' && role !== 'test' && role !== 'ship') return 'unknown';
  return classifyAdvancingSessionLifecycle(
    role,
    statuses.get(issueId.toUpperCase()),
    tmuxActive,
  );
}

export function stateToLegacySeverity(
  state: HealthState,
): SystemHealthSeverity {
  return state === 'critical'
    ? 'critical'
    : state === 'warning'
      ? 'warning'
      : 'normal';
}

function signalValue(signal: HostMetricSignal<number>): number | null {
  return signal.status === 'available' ? signal.value : null;
}

export function hostMetrics(
  sample: HostMetricSample,
): SystemHealthSnapshot['host']['metrics'] {
  return {
    cpuPercent: signalValue(sample.cpuPercent),
    loadAverage1m: signalValue(sample.loadAverage1m),
    loadPerCore1m: signalValue(sample.loadPerCore1m),
    totalMemoryBytes: signalValue(sample.totalMemoryBytes),
    usedMemoryBytes: signalValue(sample.usedMemoryBytes),
    availableMemoryBytes: signalValue(sample.availableMemoryBytes),
    memoryUsedPercent: signalValue(sample.memoryUsedPercent),
    memoryPressureSomeAvg10: signalValue(sample.memoryPressureSomeAvg10),
    memoryPressureFullAvg10: signalValue(sample.memoryPressureFullAvg10),
    memoryPressureFreePercent: signalValue(sample.memoryPressureFreePercent),
    swapTotalBytes: signalValue(sample.swapTotalBytes),
    swapUsedBytes: signalValue(sample.swapUsedBytes),
    swapUsedPercent: signalValue(sample.swapUsedPercent),
    swapActivityBytesPerMinute: signalValue(sample.swapActivityBytesPerMinute),
    committedMemoryBytes: signalValue(sample.committedMemoryBytes),
    commitLimitBytes: signalValue(sample.commitLimitBytes),
    virtualCommitmentPercent: signalValue(sample.virtualCommitmentPercent),
  };
}

export function serviceHealth(
  smeeRelay: SmeeRelayHealthEvidence,
): ServiceHealthSnapshot[] {
  if (smeeRelay.status === 'running') {
    return [{
      id: 'smee-relay',
      label: 'Webhook relay',
      required: false,
      status: 'running',
      message: smeeRelay.message,
      reasons: [],
    }];
  }
  if (smeeRelay.status === 'not_configured') {
    return [{
      id: 'smee-relay',
      label: 'Webhook relay',
      required: false,
      status: 'not_configured',
      message: smeeRelay.message,
      reasons: [],
    }];
  }

  const unavailable = smeeRelay.status === 'unknown';
  return [{
    id: 'smee-relay',
    label: 'Webhook relay',
    required: false,
    status: unavailable ? 'unavailable' : 'stopped',
    message: smeeRelay.message,
    reasons: [{
      code: unavailable
        ? 'service.smee_relay.unavailable'
        : 'service.smee_relay.stopped',
      domain: 'service',
      severity: unavailable ? 'info' : 'warning',
      message: smeeRelay.message,
    }],
  }];
}

export function overallHealthState(
  hostState: HealthState,
  agents: readonly AgentHealthSnapshot[],
  services: readonly ServiceHealthSnapshot[],
): HealthState {
  if (
    hostState === 'critical'
    || agents.some((agent) =>
      agent.status === 'dead' || agent.status === 'wedged'
    )
  ) {
    return 'critical';
  }
  if (
    hostState === 'warning'
    || agents.some((agent) =>
      agent.status === 'warning' || agent.status === 'stalled'
    )
    || services.some((service) =>
      service.status === 'degraded' || service.status === 'stopped'
    )
  ) {
    return 'warning';
  }
  if (hostState === 'measuring') return 'measuring';
  if (
    hostState === 'unavailable'
    || agents.some((agent) => agent.status === 'unavailable')
    || services.some((service) => service.status === 'unavailable')
  ) {
    return 'unavailable';
  }
  return 'healthy';
}

export function acceptedReasons(
  state: HealthState,
  hostReasons: readonly HealthReason[],
  agents: readonly AgentHealthSnapshot[],
  services: readonly ServiceHealthSnapshot[],
): HealthReason[] {
  const reasons = [
    ...hostReasons,
    ...agents.flatMap((agent) => agent.reasons),
    ...services.flatMap((service) => service.reasons),
  ];
  if (state === 'measuring' && reasons.length === 0) {
    return [{
      code: 'host.sampler.measuring',
      domain: 'host',
      severity: 'info',
      message: 'System health is collecting the initial three samples.',
    }];
  }
  return reasons;
}
