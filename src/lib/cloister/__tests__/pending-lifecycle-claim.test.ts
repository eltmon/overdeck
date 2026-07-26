import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('restores a failed claim to the canonical pending path', async () => {
    const claim = await claimPendingLifecycleFile(pendingFile);

    await claim!.restore();

    expect(readFileSync(pendingFile, 'utf-8')).toBe('{"issueId":"PAN-3138"}');
    expect(existsSync(claim!.path)).toBe(false);
  });

  it('does not overwrite a newer pending generation during restoration', async () => {
    const claim = await claimPendingLifecycleFile(pendingFile);
    writeFileSync(pendingFile, '{"issueId":"PAN-3139"}');

    await claim!.restore();

    expect(readFileSync(pendingFile, 'utf-8')).toBe('{"issueId":"PAN-3139"}');
    expect(existsSync(claim!.path)).toBe(false);
  });

  it('restores after failure when canonical retry ownership is missing', async () => {
    const claim = await claimPendingLifecycleFile(pendingFile);

    await expect(settlePendingLifecycleClaim(claim!, 'PAN-3138', false)).resolves.toBe('restored');

    expect(existsSync(pendingFile)).toBe(true);
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
