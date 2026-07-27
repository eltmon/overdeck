import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimAutoSpawnConsentForWorkStart,
  completeAutoSpawnConsentClaim,
  readAutoSpawnOnFinalizeFlag,
  releaseAutoSpawnConsentClaim,
  resolveAutoSpawnOnFinalize,
  withAutoSpawnConsentClaim,
  writeAutoSpawnOnFinalizeFlag,
} from '../spawn-planning-session.js';

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

  it('an explicit request value replaces prior-cycle consent', async () => {
    stampFlag(true);
    await expect(resolveAutoSpawnOnFinalize(false, ISSUE)).resolves.toBe(false);
    await expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).resolves.toBe(false);

    await expect(resolveAutoSpawnOnFinalize(true, ISSUE)).resolves.toBe(true);
    await expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).resolves.toBe(true);
  });

  it('a new planning launch without auto-start clears stale consent', async () => {
    stampFlag(true);
    await writeAutoSpawnOnFinalizeFlag(ISSUE, false);

    await expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).resolves.toBe(false);
  });

  it('consumes consent only after a work start is accepted', async () => {
    stampFlag(true);
    await withAutoSpawnConsentClaim(ISSUE, async () => 'not-running', { isAccepted: () => false });
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(true);

    await withAutoSpawnConsentClaim(ISSUE, async () => 'running');
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(false);
  });

  it('keeps old claims from consuming a newer planning cycle', async () => {
    await writeAutoSpawnOnFinalizeFlag(ISSUE, true);
    const oldClaim = await claimAutoSpawnConsentForWorkStart(ISSUE);
    expect(oldClaim).not.toBeNull();
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(false);

    await writeAutoSpawnOnFinalizeFlag(ISSUE, true);
    await completeAutoSpawnConsentClaim(oldClaim!);
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(true);

    const currentClaim = await claimAutoSpawnConsentForWorkStart(ISSUE);
    expect(currentClaim).not.toBeNull();
    await releaseAutoSpawnConsentClaim(currentClaim!);
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(true);

    const acceptedClaim = await claimAutoSpawnConsentForWorkStart(ISSUE);
    await completeAutoSpawnConsentClaim(acceptedClaim!);
    expect(readAutoSpawnOnFinalizeFlag(ISSUE)).toBe(false);
  });

  it('falls back to the current-cycle flag when the request omits autoSpawn', async () => {
    stampFlag(true);
    await expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).resolves.toBe(true);
  });

  it('omitted autoSpawn + no flag = no spawn (interactive planning, manual start)', async () => {
    await expect(resolveAutoSpawnOnFinalize(undefined, ISSUE)).resolves.toBe(false);
  });
});
