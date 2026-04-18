/**
 * Tests for the async cleanup helpers extracted from src/dashboard/server/routes/issues.ts (PAN-446)
 *
 * cleanupAgentStateDirs() and removeCompletionMarker() are the production functions
 * used by the abort-planning and reopen route handlers respectively.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanupAgentStateDirs, removeCompletionMarker } from '../../src/dashboard/server/routes/issues.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'issues-cleanup-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('cleanupAgentStateDirs() — abort-planning path', () => {
  it('removes an existing agent state directory and all its contents', async () => {
    const agentDir = join(testDir, 'agent-xyz');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'state.json'), '{}');

    await cleanupAgentStateDirs([agentDir]);

    expect(existsSync(agentDir)).toBe(false);
  });

  it('silently skips directories that do not exist', async () => {
    const missing = join(testDir, 'nonexistent-agent');
    await expect(cleanupAgentStateDirs([missing])).resolves.toBeUndefined();
  });

  it('removes multiple dirs in a single call', async () => {
    const dir1 = join(testDir, 'agent-1');
    const dir2 = join(testDir, 'agent-2');
    mkdirSync(dir1);
    mkdirSync(dir2);

    await cleanupAgentStateDirs([dir1, dir2]);

    expect(existsSync(dir1)).toBe(false);
    expect(existsSync(dir2)).toBe(false);
  });

  it('removes nested contents recursively', async () => {
    const nested = join(testDir, 'agent', 'subdir', 'deep');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'file.txt'), 'data');

    await cleanupAgentStateDirs([join(testDir, 'agent')]);

    expect(existsSync(join(testDir, 'agent'))).toBe(false);
  });
});

describe('removeCompletionMarker() — reopen path', () => {
  it('removes an existing completion marker file', async () => {
    const marker = join(testDir, 'completed');
    writeFileSync(marker, '');

    await removeCompletionMarker(marker);

    expect(existsSync(marker)).toBe(false);
  });

  it('is a no-op when the marker does not exist', async () => {
    const missing = join(testDir, 'completed.processed');
    await expect(removeCompletionMarker(missing)).resolves.toBeUndefined();
  });
});
