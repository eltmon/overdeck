/**
 * Tests for retro-archiver (PAN-709)
 *
 * Key regression: watchlist retros (below threshold) must NOT be archived —
 * they must stay in the main retros dir to accumulate future signals.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { archiveProcessedRetros } from '../retro-archiver.js';

// ============================================================================
// Helpers
// ============================================================================

async function makeTempRetrosDir(): Promise<string> {
  const dir = join(tmpdir(), `pan-retro-test-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeRetro(dir: string, name: string, content = '---\nsurprise: true\n---\n'): Promise<string> {
  const path = join(dir, name);
  await fs.writeFile(path, content, 'utf-8');
  return path;
}

async function listMainDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries.filter(e => e !== 'archive');
}

// ============================================================================
// Suite: archiveProcessedRetros
// ============================================================================

describe('archiveProcessedRetros', () => {
  let retrosDir: string;

  beforeEach(async () => {
    retrosDir = await makeTempRetrosDir();
  });

  afterEach(async () => {
    await fs.rm(retrosDir, { recursive: true, force: true });
  });

  it('moves specified retros to archive/run-1/ on first run', async () => {
    const path = await writeRetro(retrosDir, 'pan-001-1000.md');

    const result = await archiveProcessedRetros([path], retrosDir);

    expect(result.archived).toEqual([path]);
    expect(result.wontfixed).toEqual([]);
    expect(result.errors).toEqual([]);

    // File is gone from main dir
    await expect(fs.access(path)).rejects.toThrow();

    // File exists in archive/run-1/
    const archivePath = join(retrosDir, 'archive', 'run-1', 'pan-001-1000.md');
    await expect(fs.access(archivePath)).resolves.toBeUndefined();
  });

  it('REGRESSION: watchlist retros not in the processed list are untouched', async () => {
    // proposal retro — should be archived
    const proposalRetro = await writeRetro(retrosDir, 'pan-001-proposal.md');
    // watchlist retro — must remain to accumulate signals
    const watchlistRetro = await writeRetro(retrosDir, 'pan-002-watchlist.md');

    // Only pass the proposal retro; simulate the daemon fix
    const result = await archiveProcessedRetros([proposalRetro], retrosDir);

    expect(result.archived).toEqual([proposalRetro]);

    // proposal retro is gone from main dir
    await expect(fs.access(proposalRetro)).rejects.toThrow();

    // watchlist retro remains in main dir — it must accumulate more signals
    await expect(fs.access(watchlistRetro)).resolves.toBeUndefined();
    const remaining = await listMainDir(retrosDir);
    expect(remaining).toContain('pan-002-watchlist.md');
  });

  it('passes with an empty list — no files moved, no errors', async () => {
    await writeRetro(retrosDir, 'pan-001-1000.md');

    const result = await archiveProcessedRetros([], retrosDir);

    expect(result.archived).toEqual([]);
    expect(result.wontfixed).toEqual([]);
    expect(result.errors).toEqual([]);

    // File still in main dir
    const remaining = await listMainDir(retrosDir);
    expect(remaining).toContain('pan-001-1000.md');
  });

  it('increments run number on subsequent calls', async () => {
    const path1 = await writeRetro(retrosDir, 'pan-001-1000.md');
    await archiveProcessedRetros([path1], retrosDir);

    const path2 = await writeRetro(retrosDir, 'pan-002-2000.md');
    const result2 = await archiveProcessedRetros([path2], retrosDir);

    expect(result2.archived).toEqual([path2]);
    const archivePath = join(retrosDir, 'archive', 'run-2', 'pan-002-2000.md');
    await expect(fs.access(archivePath)).resolves.toBeUndefined();
  });

  it('ages out stale watchlist retros with a wontfix marker', async () => {
    const stalePath = await writeRetro(retrosDir, 'pan-old-30d.md', '---\nsurprise: true\n---\n# old retro\n');

    // Backdate the file to 31 days ago
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await fs.utimes(stalePath, thirtyOneDaysAgo, thirtyOneDaysAgo);

    const result = await archiveProcessedRetros([], retrosDir);

    expect(result.wontfixed).toEqual([stalePath]);
    await expect(fs.access(stalePath)).rejects.toThrow();

    const wontfixPath = join(retrosDir, 'archive', 'wontfix', 'pan-old-30d.md');
    const content = await fs.readFile(wontfixPath, 'utf-8');
    expect(content).toContain('wontfix: true');
  });

  it('does not age out fresh watchlist retros', async () => {
    const freshPath = await writeRetro(retrosDir, 'pan-fresh.md');
    // mtime is now — definitely < 30 days old

    const result = await archiveProcessedRetros([], retrosDir);

    expect(result.wontfixed).toEqual([]);
    await expect(fs.access(freshPath)).resolves.toBeUndefined();
  });
});
