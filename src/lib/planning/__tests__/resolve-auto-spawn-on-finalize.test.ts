import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAutoSpawnOnFinalizeFlag, resolveAutoSpawnOnFinalize } from '../spawn-planning-session.js';

// Locks the fix for the stranded-planning bug: finalizing a planning session
// launched with --auto-start must auto-spawn the work agent regardless of HOW
// it's finalized (CLI, dashboard Done button, or host auto-finalize). The
// dashboard Done buttons send no `autoSpawn`, so the route must fall back to
// the persisted launch-time flag.
describe('resolveAutoSpawnOnFinalize', () => {
  let home: string;
  let oldHome: string | undefined;
  const ISSUE = 'PAN-9999';

  function stampFlag(value: boolean): void {
    const dir = join(home, 'agents', `planning-${ISSUE.toLowerCase()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-spawn-on-finalize.json'), JSON.stringify({ autoSpawnOnFinalize: value }));
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'auto-spawn-flag-'));
    oldHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (oldHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('reads a stamped flag (true)', () => {
    stampFlag(true);
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(true);
  });

  it('returns false when no flag file exists', () => {
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(false);
  });

  it('an explicit request value always wins over the flag', () => {
    stampFlag(true);
    expect(resolveAutoSpawnOnFinalize(false, ISSUE)).toBe(false); // explicit false beats flag=true
    expect(resolveAutoSpawnOnFinalize(true, ISSUE)).toBe(true);
  });

  it('falls back to the flag when the request omits autoSpawn (the dashboard Done path)', () => {
    stampFlag(true);
    expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).toBe(true);
  });

  it('omitted autoSpawn + no flag = no spawn (interactive planning, manual start)', () => {
    expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).toBe(false);
  });
});
