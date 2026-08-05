import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __artifactVerdictMemoSize,
  __resetArtifactVerdictMemo,
  ARTIFACT_VERDICT_MEMO_MAX_ENTRIES,
  readLatestSynthesisVerdict,
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
  it('reads a fresh verdict only from the requested active run', () => {
    writeArtifact('old-run', 'synthesis.md', '## Verdict: APPROVED\n');
    writeArtifact('active-run', 'review.md', '## Verdict: CHANGES REQUESTED — missing null check\n', NOW - 30_000);

    const verdict = readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: workspace, runId: 'active-run' });

    expect(verdict).toMatchObject({ runId: 'active-run', verdict: 'blocked' });
  });

  it('returns no evidence when the caller omits the host-recorded run ID', () => {
    writeArtifact('forged-run', 'review.md', '## Verdict: APPROVED\n');

    expect(readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: workspace })).toBeNull();
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

  it('expires memoized verdict evidence at the freshness boundary', () => {
    writeArtifact('active-run', 'synthesis.md', '## Verdict: APPROVED\n', NOW - SYNTHESIS_ARTIFACT_FRESH_MS + 10);

    expect(readMemoizedArtifactVerdict('PAN-1', {
      now: NOW,
      workspacePath: workspace,
      runId: 'active-run',
    })?.verdict).toBe('passed');

    rmSync(join(workspace, '.pan'), { recursive: true, force: true });
    expect(readMemoizedArtifactVerdict('PAN-1', {
      now: NOW + 10,
      workspacePath: workspace,
      runId: 'active-run',
    })).toBeNull();
  });

  it('bounds memoized evidence across review runs', () => {
    for (let index = 0; index <= ARTIFACT_VERDICT_MEMO_MAX_ENTRIES; index++) {
      readMemoizedArtifactVerdict('PAN-1', {
        now: NOW,
        workspacePath: workspace,
        runId: `run-${index}`,
      });
    }

    expect(__artifactVerdictMemoSize()).toBe(ARTIFACT_VERDICT_MEMO_MAX_ENTRIES);
  });
});
