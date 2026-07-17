import type {
  HealthReason,
  SystemHealthSnapshot as AcceptedSystemHealthSnapshot,
} from '@overdeck/contracts';
import { Effect } from 'effect';

import {
  getAcceptedSystemHealthSnapshot,
  getSystemHealthSnapshot,
  type SystemHealthSnapshot as CompatibilitySystemHealthSnapshot,
} from '../../services/system-health-service.js';
import {
  evaluateSpawnGuardrails,
  type SpawnGuardrailDecision,
} from '../agents/shared.js';

export type SpawnGateState = 'open' | 'soft' | 'blocked' | 'unavailable';

export interface SpawnGatePayload {
  state: SpawnGateState;
  reason: string;
  reasons: HealthReason[];
  admittedWorkAgentCount: number | null;
  warnings: SpawnGuardrailDecision['warnings'];
  pressure: number;
  stale?: boolean;
}

interface ResourcesHealthEvidence {
  accepted: AcceptedSystemHealthSnapshot | null;
  decision: SpawnGuardrailDecision | null;
}

let readAcceptedSystemHealthSnapshot:
  () => Promise<AcceptedSystemHealthSnapshot> =
    () => getAcceptedSystemHealthSnapshot();
let readCompatibilitySystemHealthSnapshot:
  () => Promise<CompatibilitySystemHealthSnapshot> =
    () => getSystemHealthSnapshot();

export function mapSpawnGateDecision(
  decision: SpawnGuardrailDecision,
  accepted?: AcceptedSystemHealthSnapshot,
): SpawnGatePayload {
  const admission = accepted?.admission;
  const state = admission
    ? strongestAdmissionState(
        admission.state,
        decision.blocked
          ? 'blocked'
          : decision.requiresAcknowledgement
            ? 'soft'
            : 'open',
      )
    : decision.blocked
      ? 'blocked'
      : decision.requiresAcknowledgement
        ? 'soft'
        : 'open';
  const reasons = mergeAdmissionReasons(
    admission?.reasons ?? [],
    decision.warnings.map((warning) => ({
      code: warning.code,
      domain: 'admission' as const,
      severity: warning.severity,
      message: warning.message,
    })),
  );
  const reason = decision.error
    ?? decision.warnings[0]?.message
    ?? reasons[0]?.message
    ?? '';

  return {
    state,
    reason,
    reasons,
    admittedWorkAgentCount:
      admission?.admittedWorkAgentCount
      ?? decision.health.summary.workAgentCount,
    warnings: decision.warnings,
    pressure: spawnGatePressure(state),
  };
}

export function getResourcesHealthEvidenceEffect():
  Effect.Effect<ResourcesHealthEvidence, never, never> {
  return Effect.all({
    accepted: Effect.tryPromise({
      try: () => readAcceptedSystemHealthSnapshot(),
      catch: (error) => error,
    }).pipe(
      Effect.map((snapshot) => snapshot as AcceptedSystemHealthSnapshot | null),
      Effect.catch(() => Effect.succeed(null)),
    ),
    decision: Effect.tryPromise({
      try: () => readCompatibilitySystemHealthSnapshot(),
      catch: (error) => error,
    }).pipe(
      Effect.map(evaluateSpawnGuardrails),
      Effect.map((decision) => decision as SpawnGuardrailDecision | null),
      Effect.catch(() => Effect.succeed(null)),
    ),
  });
}

export function getSpawnGatePayloadEffect(
  evidence?: ResourcesHealthEvidence,
): Effect.Effect<SpawnGatePayload, never, never> {
  const source = evidence
    ? Effect.succeed(evidence)
    : getResourcesHealthEvidenceEffect();

  return source.pipe(
    Effect.map(({ accepted, decision }) => {
      if (!accepted || !decision) {
        return unavailableSpawnGate(accepted);
      }
      return mapSpawnGateDecision(decision, accepted);
    }),
  );
}

export function setSpawnGateHealthSnapshotReadersForTests(readers: {
  accepted: () => Promise<AcceptedSystemHealthSnapshot>;
  compatibility: () => Promise<CompatibilitySystemHealthSnapshot>;
}): void {
  readAcceptedSystemHealthSnapshot = readers.accepted;
  readCompatibilitySystemHealthSnapshot = readers.compatibility;
}

export function resetSpawnGateHealthSnapshotReadersForTests(): void {
  readAcceptedSystemHealthSnapshot = () => getAcceptedSystemHealthSnapshot();
  readCompatibilitySystemHealthSnapshot = () => getSystemHealthSnapshot();
}

function unavailableSpawnGate(
  accepted: AcceptedSystemHealthSnapshot | null,
): SpawnGatePayload {
  const reasons = accepted?.admission.reasons.length
    ? [...accepted.admission.reasons]
    : [{
        code: 'admission.snapshot.unavailable',
        domain: 'admission' as const,
        severity: 'critical' as const,
        message: 'Spawn gate health is unavailable.',
      }];

  return {
    state: 'unavailable',
    reason: reasons[0]?.message ?? 'Spawn gate health is unavailable.',
    reasons,
    admittedWorkAgentCount:
      accepted?.admission.admittedWorkAgentCount ?? null,
    warnings: [],
    pressure: 0,
    stale: true,
  };
}

function mergeAdmissionReasons(
  ...reasonGroups: ReadonlyArray<ReadonlyArray<HealthReason>>
): HealthReason[] {
  const seen = new Set<string>();
  return reasonGroups.flatMap((reasons) => reasons).filter((reason) => {
    const key = `${reason.code}::${reason.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function strongestAdmissionState(
  accepted: SpawnGateState,
  enforced: Exclude<SpawnGateState, 'unavailable'>,
): SpawnGateState {
  if (accepted === 'unavailable') return accepted;
  const rank: Record<Exclude<SpawnGateState, 'unavailable'>, number> = {
    open: 0,
    soft: 1,
    blocked: 2,
  };
  return rank[accepted] >= rank[enforced] ? accepted : enforced;
}

function spawnGatePressure(state: SpawnGateState): number {
  if (state === 'blocked') return 100;
  if (state === 'soft') return 67;
  if (state === 'open') return 12;
  return 0;
}
