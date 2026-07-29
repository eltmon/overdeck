import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureDir,
  ensureParentDir,
  resolveArchiveDir,
  resolveCheckpointFile,
  resolveFtsDbPath,
  resolveIssueMemoryRoot,
  resolveMemoryRoot,
  resolveObservationsFile,
  resolvePendingDir,
  resolveRagRunsFile,
  resolveStatusFile,
  resolveSummariesDir,
  resolveWorkspaceMemoryRoot,
} from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-paths-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('memory path resolvers (PAN-1990: keyed by workspaceId)', () => {
  it('resolves project and workspace memory roots under OVERDECK_HOME', () => {
    expect(resolveMemoryRoot('overdeck')).toBe(join(tempDir!, 'memory/overdeck'));
    expect(resolveWorkspaceMemoryRoot('overdeck', 'workspace-pan-1052')).toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052'));
  });

  it('resolves workspace-scoped memory artifacts', () => {
    expect(resolveObservationsFile('overdeck', 'workspace-pan-1052', '2026-05-16T20:00:00.000Z'))
      .toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052/observations/2026-05-16.jsonl'));
    expect(resolvePendingDir('overdeck', 'workspace-pan-1052'))
      .toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052/pending'));
    expect(resolveStatusFile('overdeck', 'workspace-pan-1052'))
      .toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052/status.json'));
    expect(resolveArchiveDir('overdeck', 'workspace-pan-1052'))
      .toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052/archive'));
    expect(resolveSummariesDir('overdeck', 'workspace-pan-1052'))
      .toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052/summaries'));
    expect(resolveRagRunsFile('overdeck', 'workspace-pan-1052', new Date('2026-05-16T20:00:00.000Z')))
      .toBe(join(tempDir!, 'memory/overdeck/workspace-pan-1052/rag-runs/2026-05-16.jsonl'));
  });

  it('resolves workspace checkpoint and project FTS database paths', () => {
    expect(resolveCheckpointFile('/workspace/feature-pan-1052')).toBe('/workspace/feature-pan-1052/.pan/memory-checkpoint.json');
    expect(resolveFtsDbPath('overdeck')).toBe(join(tempDir!, 'memory/overdeck/memory-search.db'));
  });

  it('keeps path functions pure and exposes separate idempotent directory helpers', async () => {
    const file = resolveRagRunsFile('overdeck', 'workspace-pan-1052', '2026-05-16');
    expect(existsSync(join(tempDir!, 'memory'))).toBe(false);

    await ensureParentDir(file);
    await ensureParentDir(file);
    expect(existsSync(join(tempDir!, 'memory/overdeck/workspace-pan-1052/rag-runs'))).toBe(true);

    const dir = resolvePendingDir('overdeck', 'workspace-pan-1052');
    await ensureDir(dir);
    await ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('keeps deprecated resolveIssueMemoryRoot working for migration use', () => {
    expect(resolveIssueMemoryRoot('overdeck', 'PAN-1052')).toBe(join(tempDir!, 'memory/overdeck/PAN-1052'));
  });

  it('rejects unsafe segments for resolveWorkspaceMemoryRoot', () => {
    expect(() => resolveWorkspaceMemoryRoot('overdeck', '..')).toThrow('Invalid memory workspaceId');
  });

  it('has no non-migration caller of the deprecated resolveIssueMemoryRoot outside paths.ts (PAN-1990 ac4)', () => {
    const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
    const output = execFileSync(
      'git',
      ['grep', '-l', 'resolveIssueMemoryRoot', '--', 'src/'],
      { cwd: repoRoot, encoding: 'utf-8' },
    );
    const files = output.trim().split('\n').filter(Boolean);
    expect(files).toEqual(['src/lib/memory/paths.ts']);
  });
});
