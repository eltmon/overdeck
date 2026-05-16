import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
} from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-paths-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('memory path resolvers', () => {
  it('resolves project and issue memory roots under PANOPTICON_HOME', () => {
    expect(resolveMemoryRoot('panopticon-cli')).toBe(join(tempDir!, 'memory/panopticon-cli'));
    expect(resolveIssueMemoryRoot('panopticon-cli', 'PAN-1052')).toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052'));
  });

  it('resolves issue-scoped memory artifacts', () => {
    expect(resolveObservationsFile('panopticon-cli', 'PAN-1052', '2026-05-16T20:00:00.000Z'))
      .toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.jsonl'));
    expect(resolvePendingDir('panopticon-cli', 'PAN-1052'))
      .toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052/pending'));
    expect(resolveStatusFile('panopticon-cli', 'PAN-1052'))
      .toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052/status.json'));
    expect(resolveArchiveDir('panopticon-cli', 'PAN-1052'))
      .toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052/archive'));
    expect(resolveSummariesDir('panopticon-cli', 'PAN-1052'))
      .toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052/summaries'));
    expect(resolveRagRunsFile('panopticon-cli', 'PAN-1052', new Date('2026-05-16T20:00:00.000Z')))
      .toBe(join(tempDir!, 'memory/panopticon-cli/PAN-1052/rag-runs/2026-05-16.jsonl'));
  });

  it('resolves workspace checkpoint and project FTS database paths', () => {
    expect(resolveCheckpointFile('/workspace/feature-pan-1052')).toBe('/workspace/feature-pan-1052/.pan/memory-checkpoint.json');
    expect(resolveFtsDbPath('panopticon-cli')).toBe(join(tempDir!, 'memory/panopticon-cli/memory-search.db'));
  });

  it('keeps path functions pure and exposes separate idempotent directory helpers', async () => {
    const file = resolveRagRunsFile('panopticon-cli', 'PAN-1052', '2026-05-16');
    expect(existsSync(join(tempDir!, 'memory'))).toBe(false);

    await ensureParentDir(file);
    await ensureParentDir(file);
    expect(existsSync(join(tempDir!, 'memory/panopticon-cli/PAN-1052/rag-runs'))).toBe(true);

    const dir = resolvePendingDir('panopticon-cli', 'PAN-1052');
    await ensureDir(dir);
    await ensureDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});
