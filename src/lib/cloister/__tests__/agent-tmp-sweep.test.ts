import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sweepAgentTmpDirs } from '../agent-tmp-sweep.js';

const NOW = new Date('2026-11-04T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let outside: string;

function ageOf(ageDays: number): Date {
  return new Date(NOW.getTime() - ageDays * DAY_MS);
}

/** Writes `<session>/scratchpad/<fileName>` and ages the file, its scratchpad dir, and the session dir to `ageDays`. */
function writeAgedSessionFile(session: string, fileName: string, ageDays: number, content = '{}'): string {
  const filePath = join(session, 'scratchpad', fileName);
  const scratchpadDir = join(session, 'scratchpad');
  mkdirSync(scratchpadDir, { recursive: true });
  writeFileSync(filePath, content);
  const time = ageOf(ageDays);
  utimesSync(filePath, time, time);
  utimesSync(scratchpadDir, time, time);
  utimesSync(session, time, time);
  return filePath;
}

function sessionDeps(sessionsByAgent: Record<string, string[]> = {}) {
  return {
    listLiveAgentIds: vi.fn(async () => new Set(Object.keys(sessionsByAgent))),
    readSessionsIndex: vi.fn(async (agentId: string) => {
      const ids = sessionsByAgent[agentId];
      return ids ? ids.map((sessionId) => JSON.stringify({ sessionId })).join('\n') : null;
    }),
    isPaused: vi.fn(() => false),
    log: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  root = mkdtempSync(join(tmpdir(), 'agent-tmp-sweep-'));
  outside = mkdtempSync(join(tmpdir(), 'agent-tmp-sweep-outside-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('sweepAgentTmpDirs', () => {
  it('removes a session dir idle over 14 days whose uuid is in no live agent index', async () => {
    const session = join(root, 'claude-1000', '-proj', 'uuid-idle');
    writeAgedSessionFile(session, 'file.txt', 15);

    const actions = await sweepAgentTmpDirs({ root, deps: sessionDeps() });

    expect(existsSync(session)).toBe(false);
    expect(actions[0]).toContain('removed 1 session directory idle over 14 days');
  });

  it('keeps a 15-day-old session dir whose uuid appears in a live agent sessions.json', async () => {
    const session = join(root, 'claude-1000', '-proj', 'uuid-live');
    writeAgedSessionFile(session, 'file.txt', 15);

    const actions = await sweepAgentTmpDirs({
      root,
      deps: sessionDeps({ 'agent-pan-1': ['uuid-live'] }),
    });

    expect(existsSync(session)).toBe(true);
    expect(actions[0]).toContain('removed 0 session director');
  });

  it('keeps a session dir with one file modified 1 day ago even though the dir itself is old', async () => {
    const session = join(root, 'claude-1000', '-proj', 'uuid-mixed');
    const oldFile = writeAgedSessionFile(session, 'old.txt', 15);
    const freshFile = join(session, 'scratchpad', 'fresh.txt');
    writeFileSync(freshFile, '{}');
    const freshTime = ageOf(1);
    utimesSync(freshFile, freshTime, freshTime);

    await sweepAgentTmpDirs({ root, deps: sessionDeps() });

    expect(existsSync(session)).toBe(true);
    expect(existsSync(oldFile)).toBe(true);
    expect(existsSync(freshFile)).toBe(true);
  });

  it('keeps everything and returns the skipped action when listLiveAgentIds returns null', async () => {
    const session = join(root, 'claude-1000', '-proj', 'uuid-idle');
    writeAgedSessionFile(session, 'file.txt', 15);
    const deps = sessionDeps();
    deps.listLiveAgentIds.mockResolvedValue(null as unknown as ReadonlySet<string>);

    const actions = await sweepAgentTmpDirs({ root, deps });

    expect(existsSync(session)).toBe(true);
    expect(actions).toEqual(['Agent tmp sweep skipped: backend liveness inventory unavailable']);
  });

  it('returns [] and reads nothing when the Deacon is globally paused', async () => {
    const readDir = vi.fn();
    const deps = { ...sessionDeps(), isPaused: vi.fn(() => true), readDir };

    const actions = await sweepAgentTmpDirs({ root, deps });

    expect(actions).toEqual([]);
    expect(readDir).not.toHaveBeenCalled();
  });

  it('never touches background-ai/, a loose file in claude-1000/, or an escaping symlink at session depth', async () => {
    const backgroundFile = join(root, 'background-ai', 'state.json');
    mkdirSync(join(root, 'background-ai'), { recursive: true });
    writeFileSync(backgroundFile, '{}');
    const oldTime = ageOf(30);
    utimesSync(backgroundFile, oldTime, oldTime);

    const looseFile = join(root, 'claude-1000', 'loose.txt');
    mkdirSync(join(root, 'claude-1000'), { recursive: true });
    writeFileSync(looseFile, '{}');
    utimesSync(looseFile, oldTime, oldTime);

    const projectDir = join(root, 'claude-1000', '-proj');
    mkdirSync(projectDir, { recursive: true });
    const escapeTarget = join(outside, 'escape-target');
    mkdirSync(escapeTarget, { recursive: true });
    const marker = join(escapeTarget, 'marker.txt');
    writeFileSync(marker, '{}');
    utimesSync(marker, oldTime, oldTime);
    utimesSync(escapeTarget, oldTime, oldTime);
    const symlinkPath = join(projectDir, 'uuid-symlink');
    symlinkSync(escapeTarget, symlinkPath);

    await sweepAgentTmpDirs({ root, deps: sessionDeps() });

    expect(existsSync(backgroundFile)).toBe(true);
    expect(existsSync(looseFile)).toBe(true);
    expect(existsSync(symlinkPath)).toBe(true);
    expect(existsSync(escapeTarget)).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });

  it('removes a project dir left empty after its only session is removed', async () => {
    const session = join(root, 'claude-1000', '-proj', 'uuid-idle');
    writeAgedSessionFile(session, 'file.txt', 15);
    const projectDir = join(root, 'claude-1000', '-proj');

    await sweepAgentTmpDirs({ root, deps: sessionDeps() });

    expect(existsSync(session)).toBe(false);
    expect(existsSync(projectDir)).toBe(false);
    expect(existsSync(join(root, 'claude-1000'))).toBe(true);
    expect(existsSync(root)).toBe(true);
  });
});
