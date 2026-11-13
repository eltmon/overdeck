import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSelfWrites,
  isRecentSelfWrite,
  recordSelfWrite,
  SELF_WRITE_MAX_STAMPS,
  SELF_WRITE_TTL_MS,
  selfWriteStampCount,
} from '../self-write-registry';

const T0 = 1_000_000;

beforeEach(() => {
  clearSelfWrites();
});

describe('self-write registry', () => {
  it('suppresses the recorded signature within 750 ms', () => {
    recordSelfWrite('k', 'sig', T0);
    expect(isRecentSelfWrite('k', 'sig', T0)).toBe(true);
    expect(isRecentSelfWrite('k', 'sig', T0 + SELF_WRITE_TTL_MS)).toBe(true);
  });

  it('does not suppress another signature or another key', () => {
    recordSelfWrite('k', 'sig', T0);
    expect(isRecentSelfWrite('k', 'other', T0 + 10)).toBe(false);
    expect(isRecentSelfWrite('other-key', 'sig', T0 + 10)).toBe(false);
  });

  it('does not suppress once more than 750 ms have passed', () => {
    recordSelfWrite('k', 'sig', T0);
    expect(isRecentSelfWrite('k', 'sig', T0 + SELF_WRITE_TTL_MS + 1)).toBe(false);
  });

  it('keeps only the newest stamp for a key', () => {
    recordSelfWrite('k', 'first', T0);
    recordSelfWrite('k', 'second', T0 + 5);
    expect(isRecentSelfWrite('k', 'first', T0 + 10)).toBe(false);
    expect(isRecentSelfWrite('k', 'second', T0 + 10)).toBe(true);
  });

  it('holds at most 256 stamps and drops the oldest', () => {
    for (let i = 0; i <= SELF_WRITE_MAX_STAMPS; i++) recordSelfWrite(`k${i}`, 'sig', T0);
    expect(SELF_WRITE_MAX_STAMPS).toBe(256);
    expect(selfWriteStampCount()).toBe(256);
    expect(isRecentSelfWrite('k0', 'sig', T0)).toBe(false);
    expect(isRecentSelfWrite(`k${SELF_WRITE_MAX_STAMPS}`, 'sig', T0)).toBe(true);
  });

  it('prunes expired stamps when a new one is recorded', () => {
    recordSelfWrite('old', 'sig', T0);
    recordSelfWrite('new', 'sig', T0 + SELF_WRITE_TTL_MS + 1);
    expect(selfWriteStampCount()).toBe(1);
  });
});
