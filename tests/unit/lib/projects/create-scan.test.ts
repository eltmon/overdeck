/**
 * Tests for findNestedRepositories (src/lib/projects/create-scan.ts).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  findNestedRepositories,
  listSuggestedRepositories,
} from '../../../../src/lib/projects/create-scan.js';

let scratch: string | null = null;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('findNestedRepositories', () => {
  it('unreadable directory returns an empty list', async () => {
    scratch = mkdtempSync(join(tmpdir(), 'create-scan-test-'));
    // A path that does not exist fails readdir the same way an unreadable one
    // does, and stays deterministic when the suite runs as root.
    await expect(findNestedRepositories(join(scratch, 'missing'))).resolves.toEqual([]);
  });

  it('listSuggestedRepositories caps at 20', async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'create-scan-test-')));
    for (let i = 0; i < 25; i++) {
      mkdirSync(join(scratch, `repo-${String(i).padStart(2, '0')}`, '.git'), { recursive: true });
    }

    const suggestions = await listSuggestedRepositories(scratch, new Set([join(scratch, 'repo-00')]));

    expect(suggestions).toHaveLength(20);
    expect(suggestions[0]).toEqual({ name: 'repo-01', path: join(scratch, 'repo-01') });
  });
});
