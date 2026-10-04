/**
 * Optional Jev (TypeSafe System One) judgment client (PAN-4369).
 *
 * `assess()` is the single entry point. It never throws: it returns `answered`, `unavailable`
 * (a gate said no, so no request was sent) or `failed` (the request went out and did not
 * succeed). Gate order, first match wins: feature toggle / cheap mode → `disabled`; no `jev:`
 * block → `not-configured`; no `jev.model` → `model-not-configured`; no key → `no-api-key`.
 *
 * The model comes only from `jev.model`. The client is built with `defaultModel` set to it and
 * every request passes it explicitly, so the SDK's env/built-in default model never applies.
 * `logLevel` is pinned to `warn` (overriding `TYPESAFE_LOG_LEVEL=debug`, which would log request
 * bodies), retries are off (callers run off hot paths; fail fast beats backoff), and the API
 * key is always passed explicitly. Nothing here logs the key, the request, or the error object.
 *
 * Each real (non-memo) answered call records one cost event as `background:<feature>`. Every
 * real request, answered or failed, also appends one row to the usage log (PAN-4508) — never
 * a memo hit, an unavailable result, or the config-load failure path — so the settings panel
 * can show per-feature call counts and the last error without reading eval logs.
 */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
  type EntryType,
  type Fetch,
  type Questions,
  type SystemOneResult,
  type Usage,
} from '@typesafe-ai/sdk';
import { loadConfigSync } from '../config-yaml.js';
import { recordBackgroundAiCost } from '../background-ai/cost.js';
import {
  resolveJevForFeature,
  type JevConfigInput,
  type JevFeature,
  type JevUnavailableReason,
  type ResolvedJevConfig,
} from './config.js';
import { dedupeInFlight, getMemoized, jevMemoKey, setMemoized, withJevSlot } from './memo.js';
import type { JevFailureReason } from './failure-reason.js';
import { QUESTION_SET_VERSION } from './questions.js';
import { appendJevUsage } from './usage-log.js';

export type { JevFailureReason } from './failure-reason.js';

export type JevAssessment<Q extends Questions> =
  | { status: 'answered'; answers: SystemOneResult<Q>['answers']; model: string; usage: Usage }
  | { status: 'unavailable'; reason: JevUnavailableReason }
  | { status: 'failed'; reason: JevFailureReason; message: string };

export interface JevAssessOptions {
  signal?: AbortSignal;
  /** Already-loaded config; defaults to loadConfigSync(). */
  config?: JevConfigInput;
  /** Transport override, for tests. */
  fetch?: Fetch;
  /** Environment used for the key fallback; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export function createJevClient(resolved: ResolvedJevConfig, opts: { fetch?: Fetch } = {}): TypeSafeClient {
  return new TypeSafeClient({
    apiKey: resolved.apiKey,
    defaultModel: resolved.model,
    ...(resolved.baseUrl ? { baseURL: resolved.baseUrl } : {}),
    logLevel: 'warn',
    timeout: resolved.timeoutMs,
    retry: { maxRetries: 0 },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export async function assess<const Q extends Questions>(
  featureKey: JevFeature,
  state: EntryType,
  questions: Q,
  options: JevAssessOptions = {},
): Promise<JevAssessment<Q>> {
  let resolved: ResolvedJevConfig;
  let key: string;
  try {
    const config = options.config ?? loadConfigSync().config;
    const resolution = resolveJevForFeature(featureKey, config, options.env);
    if (!resolution.ok) return { status: 'unavailable', reason: resolution.reason };
    resolved = resolution.config;
    key = jevMemoKey({ featureKey, model: resolved.model, questionSetVersion: QUESTION_SET_VERSION, state, questions });
  } catch (err) {
    return failed('error', err);
  }

  const memoized = getMemoized<JevAssessment<Q>>(key);
  if (memoized) return memoized;

  return dedupeInFlight(key, () =>
    withJevSlot(async (): Promise<JevAssessment<Q>> => {
      const startedAt = Date.now();
      try {
        const result = await createJevClient(resolved, { fetch: options.fetch }).systemOne(
          { state, questions, model: resolved.model },
          { signal: options.signal },
        );
        const servedModel = result.model || resolved.model;
        recordBackgroundAiCost({
          feature: featureKey,
          provider: 'custom',
          model: servedModel,
          usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
        });
        void appendJevUsage({
          ts: new Date().toISOString(),
          feature: featureKey,
          outcome: 'answered',
          model: servedModel,
          durationMs: Date.now() - startedAt,
        });
        const answered: JevAssessment<Q> = {
          status: 'answered',
          answers: result.answers,
          model: servedModel,
          usage: result.usage,
        };
        setMemoized(key, answered);
        return answered;
      } catch (err) {
        const reason = classifyJevError(err);
        void appendJevUsage({
          ts: new Date().toISOString(),
          feature: featureKey,
          outcome: 'failed',
          reason,
          ...(err instanceof APIError ? { status: err.status } : {}),
          model: resolved.model,
          durationMs: Date.now() - startedAt,
        });
        return failed(reason, err);
      }
    }),
  );
}

function failed(reason: JevFailureReason, err: unknown): { status: 'failed'; reason: JevFailureReason; message: string } {
  return { status: 'failed', reason, message: err instanceof Error ? err.message : String(err) };
}

/** Maps an SDK error to the closed failure-reason set. Subclasses are checked before their parents. */
export function classifyJevError(err: unknown): JevFailureReason {
  if (err instanceof APIUserAbortError) return 'aborted';
  if (err instanceof APITimeoutError) return 'timeout';
  if (err instanceof APIConnectionError) return 'connection-error';
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return 'auth-failed';
  if (err instanceof RateLimitError) return 'rate-limited';
  if (err instanceof BadRequestError || err instanceof NotFoundError || err instanceof UnprocessableEntityError) {
    return 'bad-request';
  }
  if (err instanceof APIError && err.status >= 500) return 'server-error';
  return 'error';
}
