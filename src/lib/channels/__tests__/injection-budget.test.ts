import { describe, expect, it } from 'vitest';
import {
  INPUT_ECHO_CONFIRM_ATTEMPTS,
  INPUT_PURGE_MAX_CHARS,
  SUPERVISOR_CLIENT_MARGIN_MS,
  echoConfirmTimeoutMs,
  inputSettleMs,
  purgeSettleMs,
  supervisorInjectionBudgetMs,
} from '../injection-budget.js';

describe('injection budget', () => {
  it('is monotonic as payload length grows', () => {
    const lengths = [0, 1, 1_024, 8 * 1_024, 30 * 1_024, 1_024 * 1_024, 10 * 1_024 * 1_024];
    const budgets = lengths.map(supervisorInjectionBudgetMs);

    expect(budgets).toEqual([...budgets].sort((a, b) => a - b));
  });

  it('preserves the documented floors', () => {
    expect(echoConfirmTimeoutMs(1_024)).toBe(2_600);
    expect(supervisorInjectionBudgetMs(0)).toBe(2 * 2_500 + 2 * 150 + 300 + 3_000);
  });

  it('caps each payload-scaled wait for a 10 MB payload', () => {
    const tenMb = 10 * 1_024 * 1_024;

    expect(echoConfirmTimeoutMs(tenMb)).toBe(15_000);
    expect(inputSettleMs(tenMb)).toBe(2_000);
    expect(purgeSettleMs(tenMb)).toBe(1_000);
    expect(supervisorInjectionBudgetMs(tenMb)).toBe(37_000);
  });

  it.each([0, 8 * 1_024, 30 * 1_024, 1_024 * 1_024])(
    'keeps the client timeout above the supervisor wait sum for %i chars',
    (length) => {
      const erased = Math.min(length, INPUT_PURGE_MAX_CHARS);
      const internalWaitSum =
        INPUT_ECHO_CONFIRM_ATTEMPTS * echoConfirmTimeoutMs(length) +
        INPUT_ECHO_CONFIRM_ATTEMPTS * purgeSettleMs(erased) +
        inputSettleMs(length);
      const clientTimeout = supervisorInjectionBudgetMs(length) + SUPERVISOR_CLIENT_MARGIN_MS;

      expect(clientTimeout).toBeGreaterThan(internalWaitSum);
    },
  );
});
