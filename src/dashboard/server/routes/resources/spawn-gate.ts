import { Effect } from 'effect';

import { getSystemHealthSnapshot, type SystemHealthSnapshot } from '../../services/system-health-service.js';
import { evaluateSpawnGuardrails, type SpawnGuardrailDecision } from '../agents/shared.js';

export type SpawnGateState = 'OPEN' | 'SOFT' | 'BLOCKED';

export interface SpawnGatePayload {
  state: SpawnGateState;
  reason: string;
  warnings: SpawnGuardrailDecision['warnings'];
  pressure: number;
  stale?: boolean;
}

let readSystemHealthSnapshot: () => Promise<SystemHealthSnapshot> = () => getSystemHealthSnapshot();

export function mapSpawnGateDecision(decision: SpawnGuardrailDecision): SpawnGatePayload {
  const reason = decision.error ?? decision.warnings[0]?.message ?? '';
  return {
    state: decision.blocked ? 'BLOCKED' : decision.requiresAcknowledgement ? 'SOFT' : 'OPEN',
    reason,
    warnings: decision.warnings,
    pressure: spawnGatePressure(decision),
  };
}

export function getSpawnGatePayloadEffect(): Effect.Effect<SpawnGatePayload, never, never> {
  return Effect.tryPromise({
    try: () => readSystemHealthSnapshot(),
    catch: (error) => error,
  }).pipe(
    Effect.map((health) => mapSpawnGateDecision(evaluateSpawnGuardrails(health))),
    Effect.catch(() => Effect.succeed({
      state: 'SOFT' as const,
      reason: 'Spawn gate health is unavailable.',
      warnings: [],
      pressure: 0,
      stale: true,
    })),
  );
}

export function setSpawnGateHealthSnapshotReaderForTests(reader: () => Promise<SystemHealthSnapshot>): void {
  readSystemHealthSnapshot = reader;
}

export function resetSpawnGateHealthSnapshotReaderForTests(): void {
  readSystemHealthSnapshot = () => getSystemHealthSnapshot();
}

function spawnGatePressure(decision: SpawnGuardrailDecision): number {
  if (decision.blocked) return 100;
  if (decision.requiresAcknowledgement) return 67;
  return 12;
}
