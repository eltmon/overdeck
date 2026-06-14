import { describe, expect, it } from 'vitest';
import { describePendingInput, PENDING_INPUT_KIND_LABEL } from '../pendingInput.js';

describe('describePendingInput', () => {
  it('returns the human label for the rateLimit kind', () => {
    expect(describePendingInput(['rateLimit'])).toBe(PENDING_INPUT_KIND_LABEL.rateLimit);
  });

  it('joins multiple kinds with their labels', () => {
    expect(describePendingInput(['askUserQuestion', 'rateLimit'])).toBe(
      `${PENDING_INPUT_KIND_LABEL.askUserQuestion}, ${PENDING_INPUT_KIND_LABEL.rateLimit}`,
    );
  });

  it('falls back to the raw kind string for unknown kinds', () => {
    expect(describePendingInput(['unknownKind'])).toBe('unknownKind');
  });

  it('returns a generic phrase for an empty kinds array', () => {
    expect(describePendingInput([])).toBe('Waiting on your input');
    expect(describePendingInput(undefined)).toBe('Waiting on your input');
  });
});
