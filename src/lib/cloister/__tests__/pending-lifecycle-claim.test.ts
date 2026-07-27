import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  claimPendingLifecycleFile,
  settlePendingLifecycleClaim,
} from '../pending-lifecycle-claim.js';
import { registerCanonicalReviewStatusResolver } from '../review-status-source.js';

describe('pending lifecycle file claim', () => {
  let dir: string;
  let pendingFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pending-lifecycle-claim-'));
    pendingFile = join(dir, 'pending-post-merge.json');
    writeFileSync(pendingFile, '{"issueId":"PAN-3138"}');
    registerCanonicalReviewStatusResolver(() => null);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('atomically gives a shared artifact to one owner', async () => {
    const [first, second] = await Promise.all([
      claimPendingLifecycleFile(pendingFile),
      claimPendingLifecycleFile(pendingFile),
    ]);
    const claims = [first, second].filter((claim) => claim !== null);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.raw).toBe('{"issueId":"PAN-3138"}');
    expect(existsSync(pendingFile)).toBe(false);
    await claims[0]!.discard();
    expect(existsSync(claims[0]!.path)).toBe(false);
  });

  it('queues a failed claim for a later caller', async () => {
    const claim = await claimPendingLifecycleFile(pendingFile);

    await claim!.restore();

    expect(existsSync(claim!.path)).toBe(false);
    expect(readdirSync(dir).filter((name) => name.includes('.queued-'))).toHaveLength(1);
    const retried = await claimPendingLifecycleFile(pendingFile);
    expect(retried?.raw).toBe('{"issueId":"PAN-3138"}');
    await retried!.discard();
  });

  it('preserves and claims both generations when a newer pending file exists', async () => {
    const older = await claimPendingLifecycleFile(pendingFile);
    writeFileSync(pendingFile, '{"issueId":"PAN-3139"}');

    await older!.restore();
    const newer = await claimPendingLifecycleFile(pendingFile);
    const recoveredOlder = await claimPendingLifecycleFile(pendingFile);

    expect(newer?.raw).toBe('{"issueId":"PAN-3139"}');
    expect(recoveredOlder?.raw).toBe('{"issueId":"PAN-3138"}');
    await expect(claimPendingLifecycleFile(pendingFile)).resolves.toBeNull();
    await newer!.discard();
    await recoveredOlder!.discard();
  });

  it('gives a dead-owner claim to exactly one recovery caller', async () => {
    const abandonedPath = `${pendingFile}.claimed-2147483647-abandoned`;
    renameSync(pendingFile, abandonedPath);

    const [first, second] = await Promise.all([
      claimPendingLifecycleFile(pendingFile),
      claimPendingLifecycleFile(pendingFile),
    ]);
    const recovered = [first, second].filter((claim) => claim !== null);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.raw).toBe('{"issueId":"PAN-3138"}');
    expect(existsSync(abandonedPath)).toBe(false);
    await recovered[0]!.discard();
  });

  it('queues after failure when canonical retry ownership is missing', async () => {
    const claim = await claimPendingLifecycleFile(pendingFile);

    await expect(settlePendingLifecycleClaim(claim!, 'PAN-3138', false)).resolves.toBe('queued');

    expect(existsSync(pendingFile)).toBe(false);
    expect(readdirSync(dir).filter((name) => name.includes('.queued-'))).toHaveLength(1);
  });

  it('discards after failure when canonical status owns the retry', async () => {
    registerCanonicalReviewStatusResolver(() => ({
      mergeStatus: 'merged',
      mergeStep: 'post-merge-cleanup',
    }));
    const claim = await claimPendingLifecycleFile(pendingFile);

    await expect(settlePendingLifecycleClaim(claim!, 'PAN-3138', false)).resolves.toBe('discarded');

    expect(existsSync(pendingFile)).toBe(false);
    expect(existsSync(claim!.path)).toBe(false);
  });
});
