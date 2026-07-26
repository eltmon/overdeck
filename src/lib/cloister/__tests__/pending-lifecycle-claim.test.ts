import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimPendingLifecycleFile } from '../pending-lifecycle-claim.js';

describe('pending lifecycle file claim', () => {
  let dir: string;
  let pendingFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pending-lifecycle-claim-'));
    pendingFile = join(dir, 'pending-post-merge.json');
    writeFileSync(pendingFile, '{"issueId":"PAN-3138"}');
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
});
