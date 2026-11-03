import { describe, expect, it } from 'vitest';
import { describePendingInput, PENDING_INPUT_KIND_LABEL } from '../pendingInput.js';

describe('describePendingInput', () => {
  it('returns the human label for the rateLimit kind', () => {
    expect(describePendingInput(['rateLimit'])).toBe(PENDING_INPUT_KIND_LABEL.rateLimit);
  });

  it('returns the human label for the paneQuestion kind', () => {
    expect(describePendingInput(['paneQuestion'])).toBe(PENDING_INPUT_KIND_LABEL.paneQuestion);
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

  describe('turn-end label (PAN-4371)', () => {
    it('replaces "Answer the agent" with the turn-end kind label when confident', () => {
      expect(describePendingInput(['agentTurnEnded'], { kind: 'asks_operator' })).toBe('Asked you a question');
    });

    it('falls back to "Answer the agent" for an unlabeled turn-end kind', () => {
      expect(describePendingInput(['agentTurnEnded'], { kind: 'progress_update' })).toBe(
        PENDING_INPUT_KIND_LABEL.agentTurnEnded,
      );
    });

    it('falls back to "Answer the agent" when there is no turn-end assessment', () => {
      expect(describePendingInput(['agentTurnEnded'])).toBe(PENDING_INPUT_KIND_LABEL.agentTurnEnded);
      expect(describePendingInput(['agentTurnEnded'], null)).toBe(PENDING_INPUT_KIND_LABEL.agentTurnEnded);
    });
  });
});
