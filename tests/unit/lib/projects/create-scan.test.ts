/**
 * Tests for findNestedRepositories (src/lib/projects/create-scan.ts).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findNestedRepositories } from '../../../../src/lib/projects/create-scan.js';

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
});
