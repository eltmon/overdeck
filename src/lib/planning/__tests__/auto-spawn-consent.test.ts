import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  autoSpawnOnFinalizeFlagPath,
  claimAutoSpawnConsentForWorkStart,
  completeAutoSpawnConsentClaim,
  readAutoSpawnConsentWorkModel,
  readAutoSpawnOnFinalizeFlagAsync,
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
    await expect(readAutoSpawnOnFinalizeFlagAsync(issueId)).resolves.toBe(false);
  });

  it('releases the claim when launch fails', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);

    await expect(withAutoSpawnConsentClaim(issueId, async () => {
      throw new Error('tmux start failed');
    })).rejects.toThrow('tmux start failed');

    await expect(readAutoSpawnOnFinalizeFlagAsync(issueId)).resolves.toBe(true);
  });

  it('allows only one launch to own a granted consent generation', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    let failFirst!: () => void;
    const mayFail = new Promise<void>((resolve) => { failFirst = resolve; });
    const firstOperation = vi.fn(async () => {
      firstEntered();
      await mayFail;
      throw new Error('pre-session setup failed');
    });
    const secondOperation = vi.fn(async () => 'running');

    const firstLaunch = withAutoSpawnConsentClaim(issueId, firstOperation);
    await entered;
    await expect(withAutoSpawnConsentClaim(issueId, secondOperation)).rejects.toThrow(
      'current generation is claimed',
    );
    expect(secondOperation).not.toHaveBeenCalled();

    failFirst();
    await expect(firstLaunch).rejects.toThrow('pre-session setup failed');
    expect(firstOperation).toHaveBeenCalledOnce();
    await expect(readAutoSpawnOnFinalizeFlagAsync(issueId)).resolves.toBe(true);
  });

  it('keeps consent spent when setup fails after session acceptance', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);

    await expect(withAutoSpawnConsentClaim(issueId, async (accept) => {
      await accept();
      throw new Error('runtime state persistence failed');
    })).rejects.toThrow('runtime state persistence failed');

    await expect(readAutoSpawnOnFinalizeFlagAsync(issueId)).resolves.toBe(false);
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

    await expect(readAutoSpawnOnFinalizeFlagAsync(issueId)).resolves.toBe(true);
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

  it('returns the stored work model while consent is not spent', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true, { workModel: 'k3' });

    await expect(readAutoSpawnConsentWorkModel(issueId)).resolves.toBe('k3');
  });

  it('preserves the work model across a new generation, and clears it on request', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true, { workModel: 'k3' });

    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    await expect(readAutoSpawnConsentWorkModel(issueId)).resolves.toBe('k3');

    await writeAutoSpawnOnFinalizeFlag(issueId, true, { workModel: null });
    await expect(readAutoSpawnConsentWorkModel(issueId)).resolves.toBeUndefined();
  });

  it('stops returning the work model once the claim is spent', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true, { workModel: 'k3' });
    const claim = await claimAutoSpawnConsentForWorkStart(issueId);
    if (!claim) throw new Error('expected a claim');

    await completeAutoSpawnConsentClaim(claim);

    await expect(readAutoSpawnConsentWorkModel(issueId)).resolves.toBeUndefined();
  });

  it('passes the granted work model on the claim into the operation', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true, { workModel: 'k3' });
    const operation = vi.fn(async (_accept, claim) => claim.workModel);

    await expect(withAutoSpawnConsentClaim(issueId, operation)).resolves.toBe('k3');
  });

  it('claims successfully with an undefined work model for a v2 record with none, and for a legacy record', async () => {
    await writeAutoSpawnOnFinalizeFlag(issueId, true);
    const v2Claim = await claimAutoSpawnConsentForWorkStart(issueId);
    expect(v2Claim?.workModel).toBeUndefined();
    if (v2Claim) await completeAutoSpawnConsentClaim(v2Claim);

    writeFileSync(autoSpawnOnFinalizeFlagPath(issueId), JSON.stringify({ autoSpawnOnFinalize: true }));
    const legacyClaim = await claimAutoSpawnConsentForWorkStart(issueId);
    expect(legacyClaim?.workModel).toBeUndefined();
  });
});
