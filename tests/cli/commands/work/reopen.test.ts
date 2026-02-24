/**
 * Tests for CLI work reopen command pure functions.
 *
 * Tests the logic that can be exercised without external API calls:
 * - formatComments: pure string formatter
 * - findLocalWorkspace: filesystem search
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('formatComments', () => {
  it('returns "No comments" when list is empty', async () => {
    const { formatComments } = await import('../../../../src/cli/commands/work/reopen.js');
    expect(formatComments([])).toBe('No comments');
  });

  it('formats a single comment with author and truncated body', async () => {
    const { formatComments } = await import('../../../../src/cli/commands/work/reopen.js');
    const result = formatComments([
      {
        id: '1',
        body: 'Fix the login bug.',
        author: 'Alice',
        createdAt: '2026-01-15T10:00:00Z',
      },
    ]);
    expect(result).toContain('Alice');
    expect(result).toContain('Fix the login bug.');
  });

  it('truncates body longer than 200 characters', async () => {
    const { formatComments } = await import('../../../../src/cli/commands/work/reopen.js');
    const longBody = 'A'.repeat(300);
    const result = formatComments([
      { id: '1', body: longBody, author: 'Bob', createdAt: '2026-01-15T10:00:00Z' },
    ]);
    expect(result).toContain('...');
    // Full body should not be present (was 300 chars, truncated to 200 + '...')
    expect(result).not.toContain(longBody);
  });

  it('sorts comments by createdAt ascending', async () => {
    const { formatComments } = await import('../../../../src/cli/commands/work/reopen.js');
    const result = formatComments([
      { id: '2', body: 'Second comment', author: 'Bob', createdAt: '2026-02-01T10:00:00Z' },
      { id: '1', body: 'First comment', author: 'Alice', createdAt: '2026-01-01T10:00:00Z' },
    ]);
    const alicePos = result.indexOf('Alice');
    const bobPos = result.indexOf('Bob');
    expect(alicePos).toBeLessThan(bobPos);
  });

  it('indents multiline comment bodies', async () => {
    const { formatComments } = await import('../../../../src/cli/commands/work/reopen.js');
    const result = formatComments([
      { id: '1', body: 'Line one\nLine two', author: 'Alice', createdAt: '2026-01-15T10:00:00Z' },
    ]);
    expect(result).toContain('Line one');
    expect(result).toContain('\n    Line two');
  });
});

describe('findLocalWorkspace', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-reopen-find-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no workspace exists', async () => {
    const { findLocalWorkspace } = await import('../../../../src/cli/commands/work/reopen.js');
    // Use a definitely-nonexistent issue ID
    const result = findLocalWorkspace('ZZZ-99999', tempDir);
    expect(result).toBeNull();
  });

  it('finds workspace when feature-<id> dir exists under workspaces/', async () => {
    const { findLocalWorkspace } = await import('../../../../src/cli/commands/work/reopen.js');

    const wsPath = join(tempDir, 'workspaces', 'feature-zzz-42');
    mkdirSync(wsPath, { recursive: true });

    const result = findLocalWorkspace('ZZZ-42', tempDir);
    expect(result).toBe(wsPath);
  });

  it('searches up multiple directory levels', async () => {
    const { findLocalWorkspace } = await import('../../../../src/cli/commands/work/reopen.js');

    // Workspace is in tempDir/workspaces/feature-zzz-43
    const wsPath = join(tempDir, 'workspaces', 'feature-zzz-43');
    mkdirSync(wsPath, { recursive: true });

    // Start search from a subdirectory
    const subDir = join(tempDir, 'subdir', 'nested');
    mkdirSync(subDir, { recursive: true });

    const result = findLocalWorkspace('ZZZ-43', subDir);
    expect(result).toBe(wsPath);
  });

  it('normalizes issue ID to lowercase for path lookup', async () => {
    const { findLocalWorkspace } = await import('../../../../src/cli/commands/work/reopen.js');

    const wsPath = join(tempDir, 'workspaces', 'feature-zzz-44');
    mkdirSync(wsPath, { recursive: true });

    // Pass uppercase — should still find the lowercase dir
    const result = findLocalWorkspace('ZZZ-44', tempDir);
    expect(result).toBe(wsPath);
  });
});
