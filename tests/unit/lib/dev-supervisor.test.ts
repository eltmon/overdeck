import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeDevSupervisorMarker,
  readDevSupervisorMarker,
  clearDevSupervisorMarker,
  isProcessAlive,
  devSupervisorRefusalLines,
} from '../../../src/lib/dev-supervisor.js';

// A pid that is effectively guaranteed not to exist on a normal system.
const DEAD_PID = 2_147_483_640;

describe('dev-supervisor marker', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-dev-sup-'));
    prevHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('returns null when no marker exists', () => {
    expect(readDevSupervisorMarker()).toBeNull();
  });

  it('round-trips a marker for a live pid', () => {
    writeDevSupervisorMarker({ pid: process.pid, dashboardPort: 3010, apiPort: 3011 });
    const marker = readDevSupervisorMarker();
    expect(marker).not.toBeNull();
    expect(marker!.pid).toBe(process.pid);
    expect(marker!.dashboardPort).toBe(3010);
    expect(marker!.apiPort).toBe(3011);
    expect(typeof marker!.startedAt).toBe('string');
  });

  it('treats a marker with a dead pid as stale and deletes it', () => {
    const path = join(home, 'dev-supervisor.json');
    writeFileSync(
      path,
      JSON.stringify({ pid: DEAD_PID, dashboardPort: 3010, apiPort: 3011, startedAt: 'x' }),
      'utf-8',
    );
    expect(existsSync(path)).toBe(true);
    expect(readDevSupervisorMarker()).toBeNull();
    expect(existsSync(path)).toBe(false); // self-healed
  });

  it('treats a corrupt marker as stale and deletes it', () => {
    const path = join(home, 'dev-supervisor.json');
    writeFileSync(path, 'not json{', 'utf-8');
    expect(readDevSupervisorMarker()).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it('clearDevSupervisorMarker removes the file', () => {
    writeDevSupervisorMarker({ pid: process.pid, dashboardPort: 3010, apiPort: 3011 });
    const path = join(home, 'dev-supervisor.json');
    expect(existsSync(path)).toBe(true);
    clearDevSupervisorMarker();
    expect(existsSync(path)).toBe(false);
  });

  it('clear is a no-op when no marker exists', () => {
    expect(() => clearDevSupervisorMarker()).not.toThrow();
  });
});

describe('isProcessAlive', () => {
  it('is true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is false for a non-existent pid', () => {
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });

  it('is false for invalid pids', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(NaN)).toBe(false);
  });
});

describe('devSupervisorRefusalLines', () => {
  it('names the pid and the refused action', () => {
    const lines = devSupervisorRefusalLines('start a detached dashboard', {
      pid: 4242,
      dashboardPort: 3010,
      apiPort: 3011,
      startedAt: 'x',
    });
    const joined = lines.join('\n');
    expect(joined).toContain('4242');
    expect(joined).toContain('start a detached dashboard');
    expect(joined).toContain('pan down');
    expect(joined).toContain('pan dev');
  });
});
