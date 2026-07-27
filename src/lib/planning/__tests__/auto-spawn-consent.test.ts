import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  autoSpawnOnFinalizeFlagPath,
  readAutoSpawnOnFinalizeFlag,
  withAutoSpawnConsentClaim,
  writeAutoSpawnOnFinalizeFlag,
} from '../auto-spawn-consent.js';

describe('auto-spawn consent claims', () => {
  let home: string;
  let previousHome: string | undefined;
  const issueId = 'PAN-3111';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'auto-spawn-consent-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('persists the spent state before returning an accepted launch', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    const operation = vi.fn(async () => 'running');

    await expect(withAutoSpawnConsentClaim(issueId, operation)).resolves.toBe('running');

    expect(operation).toHaveBeenCalledOnce();
    expect(readAutoSpawnOnFinalizeFlag(issueId)).toBe(false);
  });

  it('releases the claim when launch fails', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);

    await expect(withAutoSpawnConsentClaim(issueId, async () => {
      throw new Error('tmux start failed');
    })).rejects.toThrow('tmux start failed');

    expect(readAutoSpawnOnFinalizeFlag(issueId)).toBe(true);
  });

  it('does not let an old completion consume a newer planning generation', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    let finishLaunch!: () => void;
    const launchMayFinish = new Promise<void>((resolve) => { finishLaunch = resolve; });
    let claimAcquired!: () => void;
    const claimed = new Promise<void>((resolve) => { claimAcquired = resolve; });

    const launch = withAutoSpawnConsentClaim(issueId, async () => {
      claimAcquired();
      await launchMayFinish;
      return 'running';
    });
    await claimed;

    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    finishLaunch();
    await expect(launch).resolves.toBe('running');

    expect(readAutoSpawnOnFinalizeFlag(issueId)).toBe(true);
  });

  it('aborts before launch when existing consent state is unreadable', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    writeFileSync(autoSpawnOnFinalizeFlagPath(issueId), '{invalid-json');
    const operation = vi.fn(async () => 'running');

    await expect(withAutoSpawnConsentClaim(issueId, operation)).rejects.toThrow();

    expect(operation).not.toHaveBeenCalled();
  });

  it('aborts before launch when the consent claim cannot be persisted', async () => {
    const blockedHome = join(home, 'not-a-directory');
    writeFileSync(blockedHome, 'blocked');
    process.env.OVERDECK_HOME = blockedHome;
    const operation = vi.fn(async () => 'running');

    await expect(withAutoSpawnConsentClaim(issueId, operation)).rejects.toThrow();

    expect(operation).not.toHaveBeenCalled();
  });
});
