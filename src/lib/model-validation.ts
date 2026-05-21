import { Effect } from 'effect';
import { ModelValidationError } from './errors.js';

export const MODEL_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/@-]{0,127})$/;

export function normalizeModelOverride(value: unknown): Effect.Effect<string | undefined, ModelValidationError> {
  return Effect.try({
    try: () => {
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
    },
    catch: (cause) => new ModelValidationError({ message: (cause as Error).message }),
  });
}

export function requireModelOverride(value: unknown): Effect.Effect<string, ModelValidationError> {
  return Effect.flatMap(
    normalizeModelOverride(value),
    (model) =>
      model
        ? Effect.succeed(model)
        : Effect.fail(new ModelValidationError({ message: 'model is required' })),
  );
}

export function shellQuoteModelId(model: string): Effect.Effect<string, ModelValidationError> {
  return Effect.map(
    requireModelOverride(model),
    (normalized) => `'${normalized.replace(/'/g, `'\\''`)}'`,
  );
}
