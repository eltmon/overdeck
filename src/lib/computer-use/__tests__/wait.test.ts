import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputerUseError } from '../errors.js';
import { waitFor } from '../wait.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitFor --text (PAN-5452 ac1)', () => {
  it('resolves with the matching line once the third poll finds it', async () => {
    let call = 0;
    const runComputerOperation = vi.fn(async () => {
      call += 1;
      const treeLines = call < 3 ? ['0 window x'] : ['0 window x', '\t1 label Saved'];
      return { response: { ok: true, snapshot: { treeLines } }, screenshot: null };
    });

    const promise = waitFor({ app: 'calc', text: 'Saved' }, { runComputerOperation });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result).toEqual(['\t1 label Saved']);
    expect(runComputerOperation).toHaveBeenCalledTimes(3);
  });
});

describe('waitFor timeout (PAN-5452 ac2, ac4)', () => {
  it('throws wait_timeout when nothing ever matches within the default timeout (ac2)', async () => {
    const runComputerOperation = vi.fn(async () => ({ response: { ok: true, snapshot: { treeLines: ['0 window x'] } }, screenshot: null }));

    const promise = waitFor({ app: 'calc', text: 'nope' }, { runComputerOperation });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'wait_timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('rejects a timeout above 120000ms before any poll runs (ac4)', async () => {
    const runComputerOperation = vi.fn();
    const error = await waitFor({ app: 'calc', text: 'x', timeoutMs: 120_001 }, { runComputerOperation }).catch((e) => e);
    expect(error.code).toBe('invalid_argument');
    expect(runComputerOperation).not.toHaveBeenCalled();
  });
});

describe('waitFor keeps polling through appNotFound (PAN-5452 ac3)', () => {
  it('resolves once the app appears instead of throwing helper_error', async () => {
    let call = 0;
    const runComputerOperation = vi.fn(async () => {
      call += 1;
      if (call < 3) throw new ComputerUseError('helper_error', 'appNotFound("calc")');
      return { response: { ok: true, snapshot: { treeLines: ['0 window x', '\t1 label Ready'] } }, screenshot: null };
    });

    const promise = waitFor({ app: 'calc', text: 'Ready' }, { runComputerOperation });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;
    expect(result).toEqual(['\t1 label Ready']);
  });

  it('propagates a non-appNotFound helper error immediately', async () => {
    const runComputerOperation = vi.fn().mockRejectedValue(new ComputerUseError('helper_error', 'boom'));
    const error = await waitFor({ app: 'calc', text: 'x' }, { runComputerOperation }).catch((e) => e);
    expect(error.code).toBe('helper_error');
    expect(runComputerOperation).toHaveBeenCalledTimes(1);
  });
});

describe('waitFor --enabled (PAN-5452 ac5)', () => {
  it('keeps polling while the matching line is marked disabled', async () => {
    let call = 0;
    const runComputerOperation = vi.fn(async () => {
      call += 1;
      const treeLines = call < 2 ? ['\t1 button Save (disabled)'] : ['\t1 button Save'];
      return { response: { ok: true, snapshot: { treeLines } }, screenshot: null };
    });

    const promise = waitFor({ app: 'calc', enabled: 'Save' }, { runComputerOperation });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toEqual(['\t1 button Save']);
  });
});

describe('waitFor --window-title', () => {
  it('polls list_windows and resolves once a title matches', async () => {
    let call = 0;
    const runComputerOperation = vi.fn(async (input: { operation: { tool: string } }) => {
      call += 1;
      expect(input.operation.tool).toBe('list_windows');
      const windows = call < 2 ? [{ title: 'Other' }] : [{ title: 'Calculator' }];
      return { response: { ok: true, windows }, screenshot: null };
    });

    const promise = waitFor({ app: 'calc', windowTitle: 'calc' }, { runComputerOperation });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toEqual(['Calculator']);
  });
});

describe('waitFor argument validation', () => {
  it('throws invalid_argument when no condition is given', async () => {
    const error = await waitFor({ app: 'calc' }, {}).catch((e) => e);
    expect(error.code).toBe('invalid_argument');
  });

  it('throws invalid_argument when more than one condition is given', async () => {
    const error = await waitFor({ app: 'calc', text: 'a', enabled: 'b' }, {}).catch((e) => e);
    expect(error.code).toBe('invalid_argument');
  });
});
