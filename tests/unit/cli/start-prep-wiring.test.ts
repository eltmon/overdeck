import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __testInternals } from '../../../src/cli/commands/start.js';
import {
  createPlanningProgress,
  createPrepProgress,
  PrepStepTimeoutError,
  runStateReconcile,
  START_PREP_STEP_POLICIES,
  warnSyncMainFailure,
} from '../../../src/cli/commands/start-prep-progress.js';
import { UnsafeSyncMainStateError } from '../../../src/lib/cloister/sync-main-git.js';

const { runStartPrepStep } = __testInternals;
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

    expect(prep.step).toHaveBeenNthCalledWith(1, 'state-reconcile', 60_000, expect.any(Function), { awaitQuiescence: true });
    expect(prep.step).toHaveBeenNthCalledWith(2, 'sync-main', 240_000, expect.any(Function), { awaitQuiescence: true });
    expect(prep.step).toHaveBeenNthCalledWith(3, 'tracker-context', 60_000, expect.any(Function), { awaitQuiescence: true });
    expect(prep.step).toHaveBeenNthCalledWith(4, 'spawn', 600_000, expect.any(Function), { awaitQuiescence: true });
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

  it('bounds local reconciliation but leaves remote reconciliation unbounded', async () => {
    let localSignal: AbortSignal | undefined;
    const prep = {
      update: vi.fn(),
      step: vi.fn(async (_name: string, _budgetMs: number, fn: (signal: AbortSignal) => Promise<void>) => {
        localSignal = new AbortController().signal;
        return fn(localSignal);
      }),
    } as unknown as PrepProgress;
    const spinner = { warn: vi.fn() };
    const receivedSignals: AbortSignal[] = [];
    const reconcile = vi.fn(async (signal: AbortSignal) => { receivedSignals.push(signal); });

    await runStateReconcile(prep, spinner, false, reconcile);
    expect(prep.step).toHaveBeenCalledWith(
      'state-reconcile',
      60_000,
      reconcile,
      { awaitQuiescence: true },
    );
    expect(receivedSignals[0]).toBe(localSignal);

    vi.mocked(prep.step).mockClear();
    await runStateReconcile(prep, spinner, true, reconcile);
    expect(prep.step).not.toHaveBeenCalled();
    expect(receivedSignals[1]?.aborted).toBe(false);
  });

  it('keeps planning stream updates on the Ora spinner', () => {
    const spinner = { text: '' };
    const onComplete = vi.fn();
    const progress = createPlanningProgress(spinner, onComplete);

    progress.setSpinnerText('Planning: inspecting repository');
    progress.onComplete('planning-pan-1897');

    expect(spinner.text).toBe('Planning: inspecting repository');
    expect(onComplete).toHaveBeenCalledWith('planning-pan-1897');
  });

  it('fails start on unsafe sync state but warns for ordinary sync failures', () => {
    const spinner = { warn: vi.fn() };
    const unsafe = new UnsafeSyncMainStateError('Git quiescence could not be established');

    expect(() => warnSyncMainFailure(spinner, unsafe)).toThrow(unsafe);
    expect(spinner.warn).not.toHaveBeenCalled();

    warnSyncMainFailure(spinner, new Error('fetch failed'));
    expect(spinner.warn).toHaveBeenCalledWith('Sync main failed: fetch failed');
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

  it('fails fast when state reconciliation exceeds its budget', async () => {
    const prep = createTimeoutPrep();
    const spinner = { warn: vi.fn() };
    const resultPromise = runStartPrepStep(
      prep,
      spinner,
      'state-reconcile',
      () => new Promise<never>(() => undefined),
    );
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: 'PrepStepTimeoutError',
      message: "Prep step 'state-reconcile' exceeded its 60s budget",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
    expect(spinner.warn).not.toHaveBeenCalled();
  });

  it('aborts local reconciliation and waits for cleanup before returning its timeout', async () => {
    const prep = createPrepProgress(
      { text: '' },
      { stream: { isTTY: false, write: vi.fn() } },
    );
    const spinner = { warn: vi.fn() };
    let receivedSignal: AbortSignal | undefined;
    let finishCleanup!: () => void;
    let settled = false;
    const resultPromise = runStateReconcile(prep, spinner, false, (signal) => {
      receivedSignal = signal;
      return new Promise<void>((resolve) => { finishCleanup = resolve; });
    });
    void resultPromise.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(receivedSignal?.aborted).toBe(true);
    expect(settled).toBe(false);
    finishCleanup();
    await expect(resultPromise).rejects.toMatchObject({
      name: 'PrepStepTimeoutError',
      message: "Prep step 'state-reconcile' exceeded its 60s budget",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for spawn quiescence before returning its timeout', async () => {
    const prep = createPrepProgress(
      { text: '' },
      { stream: { isTTY: false, write: vi.fn() } },
    );
    const spinner = { warn: vi.fn() };
    let receivedSignal: AbortSignal | undefined;
    let finishSpawn!: () => void;
    let settled = false;
    const resultPromise = runStartPrepStep(
      prep,
      spinner,
      'spawn',
      (signal) => {
        receivedSignal = signal;
        return new Promise<void>((resolve) => { finishSpawn = resolve; });
      },
    );
    void resultPromise.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(600_000);

    expect(receivedSignal?.aborted).toBe(true);
    expect(settled).toBe(false);
    expect(spinner.warn).not.toHaveBeenCalled();

    finishSpawn();
    await expect(resultPromise).rejects.toMatchObject({
      name: 'PrepStepTimeoutError',
      message: "Prep step 'spawn' exceeded its 600s budget",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
