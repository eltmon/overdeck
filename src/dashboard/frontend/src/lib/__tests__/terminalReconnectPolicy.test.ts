import { describe, expect, it } from 'vitest';
import {
  FLAT_DELAY_MS,
  nextReconnectDelay,
  PATIENT_WINDOW_MS,
} from '../terminalReconnectPolicy';

describe('terminalReconnectPolicy', () => {
  it('uses exponential delays before settling at the flat delay', () => {
    const windowStartedAt = 1_000;

    expect(nextReconnectDelay({ attempt: 0, windowStartedAt }, windowStartedAt)).toBe(1_000);
    expect(nextReconnectDelay({ attempt: 1, windowStartedAt }, windowStartedAt)).toBe(2_000);
    expect(nextReconnectDelay({ attempt: 2, windowStartedAt }, windowStartedAt)).toBe(4_000);
    expect(nextReconnectDelay({ attempt: 3, windowStartedAt }, windowStartedAt)).toBe(FLAT_DELAY_MS);
    expect(nextReconnectDelay({ attempt: 10, windowStartedAt }, windowStartedAt)).toBe(FLAT_DELAY_MS);
  });

  it('returns null at and after the patient reconnect window boundary', () => {
    const windowStartedAt = 1_000;

    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt + PATIENT_WINDOW_MS - 1,
    )).toBe(FLAT_DELAY_MS);
    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt + PATIENT_WINDOW_MS,
    )).toBeNull();
    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt + PATIENT_WINDOW_MS + 1,
    )).toBeNull();
  });

  it('keeps large attempt counts at the flat delay without exponent overflow', () => {
    expect(nextReconnectDelay({ attempt: 40, windowStartedAt: 0 }, 0)).toBe(FLAT_DELAY_MS);
  });
});
