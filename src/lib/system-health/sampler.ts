/**
 * Accepts atomic host-health assessments with warmup and symmetric hysteresis.
 * The public snapshot remains measuring until evidence is collected, and later
 * state changes require three matching samples so state, metrics, and reasons
 * always advance together.
 */
import type { HealthReason, HealthState } from '@overdeck/contracts';

const DEFAULT_WARMUP_INTERVAL_MS = 1_000;
const DEFAULT_WARMUP_SAMPLES = 3;
const REQUIRED_CONSECUTIVE_SAMPLES = 3;

export interface AtomicHealthAssessment<TMetrics> {
  state: HealthState;
  reasons: HealthReason[];
  metrics: TMetrics;
  sampledAt: string;
}

export type RawHealthAssessment<TMetrics> =
  | { status: 'valid'; assessment: AtomicHealthAssessment<TMetrics> }
  | { status: 'invalid'; sampledAt: string; reason: HealthReason };

export type AssessmentFreshness =
  | { status: 'measuring'; observedAt: string }
  | { status: 'fresh'; observedAt: string }
  | { status: 'stale'; observedAt: string; reason: HealthReason };

export interface AcceptedHealthAssessment<TMetrics>
  extends AtomicHealthAssessment<TMetrics> {
  freshness: AssessmentFreshness;
  transitionVersion: number;
}

export interface AcceptedHealthTransition {
  version: number;
  previousState: HealthState;
  state: HealthState;
  reasonCodes: string[];
  acceptedAt: string;
}

export interface HysteresisState<TMetrics> {
  accepted: AcceptedHealthAssessment<TMetrics>;
  candidate: AtomicHealthAssessment<TMetrics> | null;
  candidateCount: number;
}

export interface HysteresisResult<TMetrics> {
  state: HysteresisState<TMetrics>;
  transition: AcceptedHealthTransition | null;
}

export function createMeasuringState<TMetrics>(
  metrics: TMetrics,
  observedAt: string,
): HysteresisState<TMetrics> {
  return {
    accepted: {
      state: 'measuring',
      reasons: [{
        code: 'host.sampler.measuring',
        domain: 'host',
        severity: 'info',
        message: 'System health is collecting the initial three samples.',
      }],
      metrics,
      sampledAt: observedAt,
      freshness: { status: 'measuring', observedAt },
      transitionVersion: 0,
    },
    candidate: null,
    candidateCount: 0,
  };
}

function accept<TMetrics>(
  previous: AcceptedHealthAssessment<TMetrics>,
  assessment: AtomicHealthAssessment<TMetrics>,
): HysteresisResult<TMetrics> {
  const changed = previous.state !== assessment.state;
  const transitionVersion = changed
    ? previous.transitionVersion + 1
    : previous.transitionVersion;
  const accepted: AcceptedHealthAssessment<TMetrics> = {
    ...assessment,
    freshness: { status: 'fresh', observedAt: assessment.sampledAt },
    transitionVersion,
  };

  return {
    state: { accepted, candidate: null, candidateCount: 0 },
    transition: changed
      ? {
          version: transitionVersion,
          previousState: previous.state,
          state: assessment.state,
          reasonCodes: assessment.reasons.map((entry) => entry.code),
          acceptedAt: assessment.sampledAt,
        }
      : null,
  };
}

/**
 * Applies symmetric three-sample hysteresis to one atomic assessment. Metrics
 * and reasons move with their state only when that complete assessment is
 * accepted, so readers never observe a new state paired with old evidence.
 */
export function transitionAcceptedAssessment<TMetrics>(
  previous: HysteresisState<TMetrics>,
  raw: RawHealthAssessment<TMetrics>,
): HysteresisResult<TMetrics> {
  if (raw.status === 'invalid') {
    return {
      state: {
        accepted: {
          ...previous.accepted,
          freshness: {
            status: 'stale',
            observedAt: raw.sampledAt,
            reason: raw.reason,
          },
        },
        candidate: null,
        candidateCount: 0,
      },
      transition: null,
    };
  }

  const assessment = raw.assessment;
  if (assessment.state === previous.accepted.state) {
    return accept(previous.accepted, assessment);
  }

  const candidateCount = previous.candidate?.state === assessment.state
    ? previous.candidateCount + 1
    : 1;
  if (candidateCount >= REQUIRED_CONSECUTIVE_SAMPLES) {
    return accept(previous.accepted, assessment);
  }

  return {
    state: {
      accepted: previous.accepted,
      candidate: assessment,
      candidateCount,
    },
    transition: null,
  };
}

export interface SystemHealthSamplerOptions<TMetrics> {
  collect(): Promise<RawHealthAssessment<TMetrics>>;
  measuringMetrics: TMetrics | (() => TMetrics);
  pollIntervalMs: number;
  warmupIntervalMs?: number;
  warmupSamples?: number;
  now?: () => string;
  onTransition?: (transition: AcceptedHealthTransition) => void | Promise<void>;
}

export interface SystemHealthSampler<TMetrics> {
  getSnapshot(): AcceptedHealthAssessment<TMetrics>;
  stop(): void;
}

function resolveMeasuringMetrics<TMetrics>(
  value: TMetrics | (() => TMetrics),
): TMetrics {
  return typeof value === 'function'
    ? (value as () => TMetrics)()
    : value;
}

export function createSystemHealthSampler<TMetrics>(
  options: SystemHealthSamplerOptions<TMetrics>,
): SystemHealthSampler<TMetrics> {
  const now = options.now ?? (() => new Date().toISOString());
  const warmupIntervalMs = options.warmupIntervalMs ?? DEFAULT_WARMUP_INTERVAL_MS;
  const warmupSamples = options.warmupSamples ?? DEFAULT_WARMUP_SAMPLES;
  let state = createMeasuringState(resolveMeasuringMetrics(options.measuringMetrics), now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let stopped = false;
  let samplesAttempted = 0;

  const schedule = (): void => {
    if (stopped) return;
    const delay = samplesAttempted < warmupSamples
      ? warmupIntervalMs
      : options.pollIntervalMs;
    timer = setTimeout(() => {
      void collectOnce();
    }, delay);
  };

  const collectOnce = async (): Promise<void> => {
    if (stopped) return;
    let raw: RawHealthAssessment<TMetrics>;
    try {
      raw = await options.collect();
    } catch (error) {
      const sampledAt = now();
      raw = {
        status: 'invalid',
        sampledAt,
        reason: {
          code: 'host.sampler.collection_failed',
          domain: 'host',
          severity: 'info',
          message: error instanceof Error ? error.message : 'System health collection failed.',
        },
      };
    }

    samplesAttempted++;
    const result = transitionAcceptedAssessment(state, raw);
    state = result.state;
    if (result.transition && options.onTransition) {
      try {
        await options.onTransition(result.transition);
      } catch (error) {
        console.error('[system-health] Failed to publish accepted transition:', error);
      }
    }
    schedule();
  };

  const start = (): void => {
    if (started || stopped) return;
    started = true;
    void collectOnce();
  };

  return {
    getSnapshot() {
      start();
      return state.accepted;
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
