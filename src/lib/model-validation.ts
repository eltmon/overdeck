import { Data, Effect } from 'effect';

export const MODEL_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/@-]{0,127})$/;

/** Tagged error for model-validation Effect variants. */
export class ModelValidationError extends Data.TaggedError('ModelValidationError')<{
  readonly value: unknown;
  readonly message: string;
}> {}

export function normalizeModelOverride(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('model must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!MODEL_ID_PATTERN.test(trimmed)) {
    throw new Error('model must match [A-Za-z0-9._:/@-]{1,128} with no whitespace or shell metacharacters.');
  }
  return trimmed;
}

export function requireModelOverride(value: unknown): string {
  const model = normalizeModelOverride(value);
  if (!model) {
    throw new Error('model is required');
  }
  return model;
}

export function shellQuoteModelId(model: string): string {
  const normalized = requireModelOverride(model);
  return `'${normalized.replace(/'/g, `'\\''`)}'`;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const wrapValidation = (value: unknown) => (cause: unknown): ModelValidationError =>
  new ModelValidationError({
    value,
    message: cause instanceof Error ? cause.message : String(cause),
  });

/** Effect variant of {@link normalizeModelOverride}. */
export const normalizeModelOverrideEffect = (value: unknown): Effect.Effect<string | undefined, ModelValidationError> =>
  Effect.try({ try: () => normalizeModelOverride(value), catch: wrapValidation(value) });

/** Effect variant of {@link requireModelOverride}. */
export const requireModelOverrideEffect = (value: unknown): Effect.Effect<string, ModelValidationError> =>
  Effect.try({ try: () => requireModelOverride(value), catch: wrapValidation(value) });

/** Effect variant of {@link shellQuoteModelId}. */
export const shellQuoteModelIdEffect = (model: string): Effect.Effect<string, ModelValidationError> =>
  Effect.try({ try: () => shellQuoteModelId(model), catch: wrapValidation(model) });
