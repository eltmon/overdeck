import {
  projectLegacySystemHealthSummary,
  SystemHealthSnapshot as SystemHealthSnapshotSchema,
  type HealthReason,
  type SystemHealthSnapshot,
} from '@overdeck/contracts';
import { useQuery } from '@tanstack/react-query';
import { Effect, Schema } from 'effect';

const MEASURING_POLL_MS = 1_000;
const UNAVAILABLE_POLL_MS = 15_000;

function unavailableReason(
  message: string,
  domain: HealthReason['domain'],
): HealthReason {
  return {
    code: 'system.health_snapshot.unavailable',
    domain,
    severity: 'critical',
    message,
  };
}

export function unavailableSystemHealthSnapshot(
  message = 'The system health snapshot is unavailable.',
): SystemHealthSnapshot {
  const base: Omit<SystemHealthSnapshot, 'summary'> = {
    version: 2,
    state: 'unavailable',
    updatedAt: new Date().toISOString(),
    nextPollMs: UNAVAILABLE_POLL_MS,
    host: {
      state: 'unavailable',
      platform: 'unsupported',
      reasons: [unavailableReason(message, 'host')],
      metrics: {
        cpuPercent: null,
        loadAverage1m: null,
        loadPerCore1m: null,
        totalMemoryBytes: null,
        usedMemoryBytes: null,
        availableMemoryBytes: null,
        memoryUsedPercent: null,
        memoryPressureSomeAvg10: null,
        memoryPressureFullAvg10: null,
        memoryPressureFreePercent: null,
        swapTotalBytes: null,
        swapUsedBytes: null,
        swapUsedPercent: null,
        swapActivityBytesPerMinute: null,
        committedMemoryBytes: null,
        commitLimitBytes: null,
        virtualCommitmentPercent: null,
      },
    },
    admission: {
      state: 'unavailable',
      availableMemoryBytes: null,
      admittedWorkAgentCount: 0,
      reasons: [unavailableReason(message, 'admission')],
    },
    agents: [],
    services: [],
    topConsumers: [],
  };

  return {
    ...base,
    summary: projectLegacySystemHealthSummary(base),
  };
}

export async function fetchSystemHealth(): Promise<SystemHealthSnapshot> {
  try {
    const response = await fetch('/api/system/health');
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Failed to fetch system health (${response.status}): ${body}`);
    }

    const payload: unknown = await response.json();
    return await Effect.runPromise(
      Schema.decodeUnknownEffect(SystemHealthSnapshotSchema)(payload),
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'The system health snapshot is unavailable.';
    return unavailableSystemHealthSnapshot(message);
  }
}

export function useSystemHealth() {
  return useQuery<SystemHealthSnapshot>({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot) return false;
      return snapshot.state === 'measuring'
        ? MEASURING_POLL_MS
        : snapshot.nextPollMs;
    },
  });
}
