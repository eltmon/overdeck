export const MODEL_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,127})$/;

export function normalizeModelOverride(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('model must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!MODEL_ID_PATTERN.test(trimmed)) {
    throw new Error('model must match [A-Za-z0-9._:/-]{1,128} with no whitespace or shell metacharacters.');
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
