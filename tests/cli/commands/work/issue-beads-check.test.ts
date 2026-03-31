/**
 * Tests for hasBeadsTasks — the beads enforcement check in pan work issue (PAN-336)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-issue-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('hasBeadsTasks', () => {
  it('returns false when .beads directory does not exist', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/work/issue.js');
    expect(hasBeadsTasks(tmpDir)).toBe(false);
  });

  it('returns true when .beads directory exists (fallback: bd not available)', async () => {
    // When bd CLI is unavailable, hasBeadsTasks falls back to checking .beads directory existence.
    // This is deliberately permissive — better to let the agent start than block it.
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/work/issue.js');
    mkdirSync(join(tmpDir, '.beads'));
    expect(hasBeadsTasks(tmpDir)).toBe(true);
  });

  it('returns true when .beads/issues.jsonl exists', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/work/issue.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), '{"id":"1","title":"Task"}\n');
    expect(hasBeadsTasks(tmpDir)).toBe(true);
  });

  it('returns true even when issues.jsonl is empty', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/work/issue.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), '');
    expect(hasBeadsTasks(tmpDir)).toBe(true);
  });
});
