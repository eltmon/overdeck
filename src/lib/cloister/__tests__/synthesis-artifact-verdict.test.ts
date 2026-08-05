import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __artifactVerdictMemoSize,
  __resetArtifactVerdictMemo,
  ARTIFACT_VERDICT_MEMO_MAX_ENTRIES,
  readLatestSynthesisVerdictAsync,
  readMemoizedArtifactVerdict,
  SYNTHESIS_ARTIFACT_FRESH_MS,
} from '../synthesis-verdict.js';
import { readActiveReviewArtifactAsync } from '../verdict-restore.js';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
let workspace: string;

function writeArtifact(runId: string, filename: 'synthesis.md' | 'review.md', content: string, mtimeMs = NOW - 60_000): void {
  const dir = join(workspace, '.pan', 'review', runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, content);
  const at = new Date(mtimeMs);
  utimesSync(path, at, at);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'synth-guard-'));
  __resetArtifactVerdictMemo();
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  __resetArtifactVerdictMemo();
});

describe('active review artifact evidence', () => {
  it('reads a fresh verdict only from the requested active run', async () => {
    writeArtifact('old-run', 'synthesis.md', '## Verdict: APPROVED\n');
    writeArtifact('active-run', 'review.md', '## Verdict: CHANGES REQUESTED — missing null check\n', NOW - 30_000);

    await expect(readLatestSynthesisVerdictAsync('PAN-1', {
      now: NOW,
      workspacePath: workspace,
      runId: 'active-run',
    })).resolves.toMatchObject({ runId: 'active-run', verdict: 'blocked' });
  });

  it('returns no evidence when the caller omits the host-recorded run ID', async () => {
    writeArtifact('forged-run', 'review.md', '## Verdict: APPROVED\n');

    await expect(readLatestSynthesisVerdictAsync('PAN-1', {
      now: NOW,
      workspacePath: workspace,
    })).resolves.toBeNull();
  });

  it('does not use an artifact from a prior review cycle', async () => {
    writeArtifact('prior-run', 'synthesis.md', '## Verdict: APPROVED\n');

    await expect(readActiveReviewArtifactAsync('PAN-1', { workspacePath: workspace, runId: 'current-run' })).resolves.toBeNull();
  });

  it('reads active-run evidence asynchronously for recovery callers', async () => {
    writeArtifact('active-run', 'synthesis.md', '## Verdict: APPROVED\n');

    await expect(readLatestSynthesisVerdictAsync('PAN-1', { workspacePath: workspace, runId: 'active-run' })).resolves.toMatchObject({
      runId: 'active-run',
      verdict: 'passed',
    });
  });

  it('rejects a stale artifact from the active run', async () => {
    writeArtifact('active-run', 'synthesis.md', '## Verdict: APPROVED\n', NOW - SYNTHESIS_ARTIFACT_FRESH_MS - 1);

    await expect(readLatestSynthesisVerdictAsync('PAN-1', { workspacePath: workspace, runId: 'active-run', now: NOW })).resolves.toBeNull();
  });

  it('returns only an asynchronously populated memo entry and expires it at the freshness boundary', async () => {
    writeArtifact('active-run', 'synthesis.md', '## Verdict: APPROVED\n', NOW - SYNTHESIS_ARTIFACT_FRESH_MS + 10);
    const options = { now: NOW, workspacePath: workspace, runId: 'active-run' };

    expect(readMemoizedArtifactVerdict('PAN-1', options)).toBeNull();
    await readLatestSynthesisVerdictAsync('PAN-1', options);
    expect(readMemoizedArtifactVerdict('PAN-1', options)?.verdict).toBe('passed');

    rmSync(join(workspace, '.pan'), { recursive: true, force: true });
    expect(readMemoizedArtifactVerdict('PAN-1', {
      ...options,
      now: NOW + 10,
    })).toBeNull();
  });

  it('bounds asynchronously populated evidence across review runs', async () => {
    for (let index = 0; index <= ARTIFACT_VERDICT_MEMO_MAX_ENTRIES; index++) {
      await readLatestSynthesisVerdictAsync('PAN-1', {
        now: NOW,
        workspacePath: workspace,
        runId: `run-${index}`,
      });
    }

    expect(__artifactVerdictMemoSize()).toBe(ARTIFACT_VERDICT_MEMO_MAX_ENTRIES);
  });
});
