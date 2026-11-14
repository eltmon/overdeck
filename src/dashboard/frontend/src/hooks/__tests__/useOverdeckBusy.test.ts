import { describe, expect, it } from 'vitest';

import { isOverdeckBusy } from '../useOverdeckBusy';

describe('isOverdeckBusy', () => {
  it('is idle with no running agents and no mid-turn conversations', () => {
    expect(isOverdeckBusy([{ status: 'stopped' }, { status: 'error' }], [{ isWorking: false }, {}])).toBe(false);
  });

  it('is busy while an agent is running or starting', () => {
    expect(isOverdeckBusy([{ status: 'running' }], [])).toBe(true);
    expect(isOverdeckBusy([{ status: 'starting' }], [])).toBe(true);
  });

  it('is busy while a conversation is mid-turn', () => {
    expect(isOverdeckBusy([], [{ isWorking: false }, { isWorking: true }])).toBe(true);
  });
});
