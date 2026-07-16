import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __testInternals } from '../../../src/cli/commands/start.js';
import { PrepStepTimeoutError } from '../../../src/cli/commands/start-prep-progress.js';

const { runStartPrepStep, START_PREP_STEP_POLICIES } = __testInternals;
type PrepProgress = Parameters<typeof runStartPrepStep>[0];
type PrepStepName = keyof typeof START_PREP_STEP_POLICIES;

function createTimeoutPrep(): PrepProgress {
  return {
    update: vi.fn(),
    step: vi.fn((name: string, budgetMs: number) => new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new PrepStepTimeoutError(name, budgetMs)), budgetMs);
    })),
  } as unknown as PrepProgress;
}

describe('pan start prep step wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes all four phases through prep.step with their configured budgets', async () => {
    const events: string[] = [];
    const prep = {
      update: vi.fn(),
      step: vi.fn(async (name: string, _budgetMs: number, fn: () => Promise<string>) => {
        events.push(`step:${name}`);
        return fn();
      }),
    } as unknown as PrepProgress;
    const spinner = { warn: vi.fn() };
    const phases = Object.keys(START_PREP_STEP_POLICIES) as PrepStepName[];

    for (const phase of phases) {
      await runStartPrepStep(prep, spinner, phase, async () => {
        events.push(`fn:${phase}`);
        return phase;
      });
    }

    expect(prep.step).toHaveBeenNthCalledWith(1, 'state-reconcile', 60_000, expect.any(Function));
    expect(prep.step).toHaveBeenNthCalledWith(2, 'sync-main', 240_000, expect.any(Function));
    expect(prep.step).toHaveBeenNthCalledWith(3, 'tracker-context', 60_000, expect.any(Function));
    expect(prep.step).toHaveBeenNthCalledWith(4, 'spawn', 600_000, expect.any(Function));
    expect(events).toEqual([
      'step:state-reconcile',
      'fn:state-reconcile',
      'step:sync-main',
      'fn:sync-main',
      'step:tracker-context',
      'fn:tracker-context',
      'step:spawn',
      'fn:spawn',
    ]);
  });

  it.each([
    ['sync-main', 240_000, undefined],
    ['tracker-context', 60_000, ''],
  ] as const)('degrades when %s exceeds its budget', async (phase, budgetMs, fallback) => {
    const prep = createTimeoutPrep();
    const spinner = { warn: vi.fn() };
    const resultPromise = runStartPrepStep(
      prep,
      spinner,
      phase,
      () => new Promise<never>(() => undefined),
      fallback,
    );

    await vi.advanceTimersByTimeAsync(budgetMs);

    await expect(resultPromise).resolves.toBe(fallback);
    expect(spinner.warn).toHaveBeenCalledWith(
      `Prep step '${phase}' exceeded its ${budgetMs / 1_000}s budget`,
    );
  });

  it.each([
    ['state-reconcile', 60_000],
    ['spawn', 600_000],
  ] as const)('fails fast when %s exceeds its budget', async (phase, budgetMs) => {
    const prep = createTimeoutPrep();
    const spinner = { warn: vi.fn() };
    const resultPromise = runStartPrepStep(
      prep,
      spinner,
      phase,
      () => new Promise<never>(() => undefined),
    );
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: 'PrepStepTimeoutError',
      message: `Prep step '${phase}' exceeded its ${budgetMs / 1_000}s budget`,
    });

    await vi.advanceTimersByTimeAsync(budgetMs);

    await rejection;
    expect(spinner.warn).not.toHaveBeenCalled();
  });
});
