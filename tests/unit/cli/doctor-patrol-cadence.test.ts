/**
 * PAN-3894 (W5, FR-4): `pan doctor` prints a "Patrol cadences" block so the
 * operator can see what runs on the 60 s tick and what runs from the
 * housekeeping scheduler, with each chore's cadence, last run, and next due.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const T0 = Date.UTC(2026, 8, 18, 12, 0, 0);

let home: string;
let originalHome: string | undefined;
let lines: string[];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'pan3894-doctor-'));
  process.env.OVERDECK_HOME = home;
  mkdirSync(join(home, 'deacon'), { recursive: true });
  writeFileSync(
    join(home, 'deacon', 'housekeeping.json'),
    JSON.stringify({ version: 1, lastRunAt: { patrolStaleTaskClaims: new Date(T0).toISOString() } }),
    'utf8',
  );
  lines = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  vi.resetModules();
});

describe('pan doctor patrol cadence table (PAN-3894 W5)', () => {
  it('prints a header, 14 tick rows, and 29 chore rows', async () => {
    const { printPatrolCadenceTable } = await import('../../../src/cli/commands/doctor.js');
    printPatrolCadenceTable();

    expect(lines.some((l) => l.includes('Patrol cadences'))).toBe(true);
    expect(lines.filter((l) => l.trimStart().startsWith('tick '))).toHaveLength(14);
    const choreLines = lines.filter((l) => /^\s+(fast|hourly|daily)\s/.test(l));
    expect(choreLines).toHaveLength(29);
  });

  it('labels the invariant checker every 10 ticks and the five alarms as alarms', async () => {
    const { printPatrolCadenceTable } = await import('../../../src/cli/commands/doctor.js');
    printPatrolCadenceTable();

    expect(lines.some((l) => l.includes('runInvariantChecker') && l.includes('every 10 ticks'))).toBe(true);
    expect(lines.some((l) => l.includes('runStallSweeperPatrol') && l.includes('(alarm)'))).toBe(true);
    expect(lines.some((l) => l.includes('checkMassDeath') && l.includes('(alarm)'))).toBe(true);
    expect(lines.some((l) => l.includes('swarmJanitorPass') && l.includes('every tick') && !l.includes('(alarm)'))).toBe(true);
  });

  it('shows a seeded chore last run and its next due, and "never"/"now" for one that has not run', async () => {
    const { printPatrolCadenceTable } = await import('../../../src/cli/commands/doctor.js');
    printPatrolCadenceTable();

    const seeded = lines.find((l) => l.includes('patrolStaleTaskClaims'));
    expect(seeded).toContain(new Date(T0).toISOString());
    expect(seeded).toContain(new Date(T0 + 5 * 60_000).toISOString());

    const never = lines.find((l) => l.includes('pruneTerminalStoppedAgents'));
    expect(never).toContain('last never');
    expect(never).toContain('next now');
  });

  it('names the reactive trigger on the chores that have one', async () => {
    const { printPatrolCadenceTable } = await import('../../../src/cli/commands/doctor.js');
    printPatrolCadenceTable();

    const idle = lines.find((l) => l.includes('reconcileIdleWorkspaceStacks'));
    expect(idle).toContain('(also on agent.stopped / agent.started)');
  });
});
