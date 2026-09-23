/**
 * PAN-3920 review: a `findRolloutPath` miss is remembered for 10 s, so hot
 * read paths (the Agents Directory resolving a Codex transcript every build)
 * do not re-walk the sessions tree on every call, and a rollout written after
 * the miss is found once the window passes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findRolloutPath } from '../codex.js';

let home: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
  home = mkdtempSync(join(tmpdir(), 'codex-miss-'));
  mkdirSync(join(home, 'sessions', '2026', '09', '23'), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

describe('findRolloutPath — miss cache', () => {
  it('answers a recent miss from cache, then finds the rollout after the window', () => {
    expect(findRolloutPath(home, 'thread-late')).toBeNull();
    const rollout = join(home, 'sessions', '2026', '09', '23', 'rollout-x-thread-late.jsonl');
    writeFileSync(rollout, '');

    expect(findRolloutPath(home, 'thread-late')).toBeNull();
    vi.setSystemTime(new Date('2026-09-23T12:00:10.001Z'));
    expect(findRolloutPath(home, 'thread-late')).toBe(rollout);
  });

  it('never caches a hit as a miss', () => {
    const rollout = join(home, 'sessions', '2026', '09', '23', 'rollout-x-thread-now.jsonl');
    writeFileSync(rollout, '');
    expect(findRolloutPath(home, 'thread-now')).toBe(rollout);
    expect(findRolloutPath(home, 'thread-now')).toBe(rollout);
  });
});
