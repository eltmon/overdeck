import { describe, expect, it } from 'vitest';
import {
  createReconnectJitter,
  FLAT_DELAY_MS,
  MAX_RECONNECT_JITTER_MS,
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

  it('adds bounded jitter to exponential and flat delays', () => {
    const windowStartedAt = 1_000;

    expect(nextReconnectDelay(
      { attempt: 0, windowStartedAt },
      windowStartedAt,
      250,
    )).toBe(1_250);
    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt,
      250,
    )).toBe(FLAT_DELAY_MS + 250);
    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt,
      MAX_RECONNECT_JITTER_MS + 1,
    )).toBe(FLAT_DELAY_MS + MAX_RECONNECT_JITTER_MS);
  });

  it('creates deterministic bounded jitter from an injected random source', () => {
    expect(createReconnectJitter(() => 0)).toBe(0);
    expect(createReconnectJitter(() => 0.5)).toBe(250);
    expect(createReconnectJitter(() => 1)).toBe(MAX_RECONNECT_JITTER_MS);
    expect(createReconnectJitter(() => -1)).toBe(0);
    expect(createReconnectJitter(() => Number.NaN)).toBe(0);
  });

  it('returns null at and after the patient reconnect window boundary', () => {
    const windowStartedAt = 1_000;

    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt + PATIENT_WINDOW_MS - 1,
      MAX_RECONNECT_JITTER_MS,
    )).toBe(FLAT_DELAY_MS + MAX_RECONNECT_JITTER_MS);
    expect(nextReconnectDelay(
      { attempt: 3, windowStartedAt },
      windowStartedAt + PATIENT_WINDOW_MS,
      MAX_RECONNECT_JITTER_MS,
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
