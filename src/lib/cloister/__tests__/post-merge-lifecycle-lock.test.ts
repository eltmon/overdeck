import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testHome = vi.hoisted(() => `/tmp/post-merge-lifecycle-lock-${process.pid}`);

vi.mock('../../paths.js', () => ({ OVERDECK_HOME: testHome }));

import {
  acquirePostMergeLifecycleLock,
  withPostMergeLifecycleLock,
} from '../post-merge-lifecycle-lock.js';

describe('post-merge lifecycle cross-process lock', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('allows only one owner until the lock is released', async () => {
    const release = await acquirePostMergeLifecycleLock('PAN-3138');

    expect(release).not.toBeNull();
    await expect(acquirePostMergeLifecycleLock('PAN-3138')).resolves.toBeNull();
    await release!();

    const releaseAgain = await acquirePostMergeLifecycleLock('PAN-3138');
    expect(releaseAgain).not.toBeNull();
    await releaseAgain!();
  });

  it('releases the lock when lifecycle execution fails', async () => {
    await expect(withPostMergeLifecycleLock('PAN-3138', async () => {
      throw new Error('tracker failed');
    })).rejects.toThrow('tracker failed');

    const release = await acquirePostMergeLifecycleLock('PAN-3138');
    expect(release).not.toBeNull();
    await release!();
  });

  it('recovers a lock whose owning process is gone', async () => {
    const lockDir = join(testHome, 'locks', 'post-merge-lifecycle');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'PAN-3138.lock'), '2147483647');

    const release = await acquirePostMergeLifecycleLock('PAN-3138');

    expect(release).not.toBeNull();
    await release!();
  });
});
