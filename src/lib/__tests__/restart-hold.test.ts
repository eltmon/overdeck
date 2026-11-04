import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseRestartHoldUntil,
  readRestartHold,
  releaseRestartHold,
  restartHoldActor,
  restartHoldPath,
  restartHoldRefusal,
  writeRestartHold,
} from '../restart-hold.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
const T0 = Date.parse('2026-11-04T10:35:00.000Z');
let testHome: string;

describe('restart hold (PAN-5007)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    testHome = join(tmpdir(), `overdeck-restart-hold-${process.pid}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('reads null when no hold was ever set', async () => {
    expect(await readRestartHold()).toBeNull();
  });

  it('writes the hold with mode 0600 and reads it back', async () => {
    const hold = { reason: 'live check', who: 'operator', setAt: new Date(T0).toISOString() };
    await writeRestartHold(hold);

    expect(await readRestartHold()).toEqual(hold);
    expect(statSync(restartHoldPath()).mode & 0o777).toBe(0o600);
  });

  it('replaces an existing hold', async () => {
    await writeRestartHold({ reason: 'first', who: 'a', setAt: new Date(T0).toISOString() });
    await writeRestartHold({ reason: 'second', who: 'b', setAt: new Date(T0).toISOString() });

    expect((await readRestartHold())?.reason).toBe('second');
  });

  it('treats an expired hold as released without deleting the file', async () => {
    const until = new Date(T0 + 60_000).toISOString();
    await writeRestartHold({ reason: 'short', who: 'operator', setAt: new Date(T0).toISOString(), until });

    expect(await readRestartHold()).not.toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(await readRestartHold()).toBeNull();
    expect(JSON.parse(readFileSync(restartHoldPath(), 'utf8')).reason).toBe('short');
  });

  it('ignores a malformed hold file', async () => {
    mkdirSync(testHome, { recursive: true });
    writeFileSync(restartHoldPath(), '{"reason": 3}');

    expect(await readRestartHold()).toBeNull();
  });

  it('release deletes the file and returns what was held', async () => {
    await writeRestartHold({ reason: 'live check', who: 'operator', setAt: new Date(T0).toISOString() });

    expect((await releaseRestartHold())?.reason).toBe('live check');
    expect(await readRestartHold()).toBeNull();
    expect(await releaseRestartHold()).toBeNull();
  });

  it('parses --until durations and ISO times', () => {
    expect(parseRestartHoldUntil('90m')).toBe(new Date(T0 + 90 * 60_000).toISOString());
    expect(parseRestartHoldUntil('2h')).toBe(new Date(T0 + 2 * 3_600_000).toISOString());
    expect(parseRestartHoldUntil('1d')).toBe(new Date(T0 + 86_400_000).toISOString());
    expect(parseRestartHoldUntil('2026-11-04T18:00:00Z')).toBe('2026-11-04T18:00:00.000Z');
  });

  it('rejects an unparseable or past --until', () => {
    expect(() => parseRestartHoldUntil('soon')).toThrow(/--until must be a duration/);
    expect(() => parseRestartHoldUntil('2h30')).toThrow(/--until must be a duration/);
    expect(() => parseRestartHoldUntil('2026-11-04T09:00:00Z')).toThrow(/must be in the future/);
  });

  it('names the setter from the initiator, agent id, conversation, then the OS user', () => {
    expect(restartHoldActor({ OVERDECK_RESTART_INITIATOR: 'flywheel', OVERDECK_AGENT_ID: 'agent-1' })).toBe('flywheel');
    expect(restartHoldActor({ OVERDECK_AGENT_ID: 'agent-1', OVERDECK_CONVERSATION: 'conv-9' })).toBe('agent-1');
    expect(restartHoldActor({ OVERDECK_CONVERSATION: 'conv-9' })).toBe('conv-9');
    expect(restartHoldActor({})).toBeTruthy();
  });

  it('refusal names the reason, how to release, and the do-not-release rule', () => {
    const message = restartHoldRefusal('reload the dashboard', {
      reason: 'live check',
      who: 'operator',
      setAt: new Date(T0).toISOString(),
    });

    expect(message).toContain('Refusing to reload the dashboard');
    expect(message).toContain('"live check"');
    expect(message).toContain('pan restart release');
    expect(message).toContain('Do not release a hold you did not set');
  });
});
