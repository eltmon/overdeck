import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave, type AutosaveReason } from '../autosave';

function harness(dirty = true) {
  const saves: AutosaveReason[] = [];
  const state = { dirty };
  const autosave = createAutosave({ save: (reason) => saves.push(reason), isDirty: () => state.dirty });
  return { autosave, saves, state };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosave', () => {
  it('saves once, 1,000 ms after the last of several changes', async () => {
    const { autosave, saves } = harness();
    expect(AUTOSAVE_DELAY_MS).toBe(1000);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(300);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(300);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(999);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toEqual(['timer']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves).toEqual(['timer']);
  });

  it('saves at once on blur and drops the armed timer', async () => {
    const { autosave, saves } = harness();
    autosave.changed();
    autosave.blurred();
    expect(saves).toEqual(['blur']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saves).toEqual(['blur']);
  });

  it('saveNow saves at once and cancels the armed timer', async () => {
    const { autosave, saves } = harness();
    autosave.changed();
    autosave.saveNow();
    expect(saves).toEqual(['explicit']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(saves).toEqual(['explicit']);
  });

  it('dispose saves with close when the timer is armed', async () => {
    const { autosave, saves } = harness();
    autosave.changed();
    autosave.dispose();
    expect(saves).toEqual(['close']);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saves).toEqual(['close']);
  });

  it('dispose sends nothing when no timer is armed', async () => {
    const { autosave, saves } = harness();
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    autosave.dispose();
    expect(saves).toEqual(['timer']);
  });

  it('never saves a clean draft', async () => {
    const { autosave, saves } = harness(false);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    autosave.blurred();
    autosave.saveNow();
    autosave.changed();
    autosave.dispose();
    expect(saves).toEqual([]);
  });
});
