/**
 * Tests for getActiveSessionPath() in src/lib/agent-enrichment.ts (PAN-446)
 *
 * getActiveSessionPath() now uses async readdir + stat (fs/promises) to find
 * the most-recently-modified JSONL file in a Claude project directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getActiveSessionPath } from '../../src/lib/agent-enrichment.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'agent-enrichment-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('getActiveSessionPath()', () => {
  it('returns null when the project dir does not exist', async () => {
    const missing = join(testDir, 'nonexistent');
    expect(await getActiveSessionPath(missing)).toBeNull();
  });

  it('returns null when the project dir contains no .jsonl files', async () => {
    writeFileSync(join(testDir, 'not-a-session.txt'), 'data');
    expect(await getActiveSessionPath(testDir)).toBeNull();
  });

  it('returns the path to the single .jsonl file when only one exists', async () => {
    const file = join(testDir, 'session-a.jsonl');
    writeFileSync(file, '{}');
    expect(await getActiveSessionPath(testDir)).toBe(file);
  });

  it('returns the most-recently-modified .jsonl file when multiple exist', async () => {
    const older = join(testDir, 'session-old.jsonl');
    const newer = join(testDir, 'session-new.jsonl');

    writeFileSync(older, '{}');
    writeFileSync(newer, '{}');

    // Force older to have an earlier mtime
    const past = new Date(Date.now() - 10_000);
    utimesSync(older, past, past);

    expect(await getActiveSessionPath(testDir)).toBe(newer);
  });

  it('ignores non-.jsonl files when selecting the most recent', async () => {
    const jsonl = join(testDir, 'session.jsonl');
    const txt = join(testDir, 'notes.txt');

    writeFileSync(jsonl, '{}');
    writeFileSync(txt, 'noise');

    // Make the txt file newer — it should still be ignored
    const future = new Date(Date.now() + 10_000);
    utimesSync(txt, future, future);

    expect(await getActiveSessionPath(testDir)).toBe(jsonl);
  });
});
