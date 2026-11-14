/**
 * PAN-5218: the deacon-lite patrol re-runs the advisory follow-up filer only
 * for merged issues with a pending candidate old enough not to race the kick.
 * Ages are plain timestamps against a fixed `now`, so no timers are involved.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAdvisoryFollowupsForTests } from '../../../../src/lib/cloister/advisory-followup.js';
import { recoverAdvisoryFollowups } from '../../../../src/lib/cloister/advisory-followup-patrol.js';
import type { PipelineJournalEntry } from '../../../../src/lib/cloister/pipeline-journal.js';

const NOW = Date.parse('2026-11-13T22:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function merged(at: string): PipelineJournalEntry {
  return { at, type: 'merge.completed', issueId: 'PAN-1', source: 'post-merge-lifecycle' };
}

function delivered(at: string, dedupKey = 'coderabbit-feedback:pan-1:900'): PipelineJournalEntry {
  return {
    at, type: 'feedback.delivered', issueId: 'PAN-1',
    data: { kind: 'coderabbit', dedupKey, agentId: 'a', repo: 'eltmon/overdeck', prNumber: 42, reviewId: 900, threads: [{ id: 11, title: 't' }] },
  };
}

let root: string;
let wsA: string;
let wsB: string;

beforeEach(() => {
  __resetAdvisoryFollowupsForTests();
  root = mkdtempSync(join(tmpdir(), 'pan-5218-patrol-'));
  wsA = mkdtempSync(join(root, 'a-'));
  wsB = mkdtempSync(join(root, 'b-'));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(journals: Record<string, PipelineJournalEntry[]>, file = vi.fn(async () => [])) {
  const workspaces = [{ issueId: 'PAN-1', path: wsA }, { issueId: 'PAN-2', path: wsB }].filter((ws) => journals[ws.path]);
  const log = vi.fn();
  const result = recoverAdvisoryFollowups(NOW, {
    listWorkspaces: () => workspaces,
    readJournal: (path) => journals[path] ?? [],
    file,
    log,
  });
  return { result, file, log };
}

describe('recoverAdvisoryFollowups', () => {
  it('files a delivery journaled after the merge once both are old enough', async () => {
    const { result, file } = run({ [wsA]: [merged(minutesAgo(15)), delivered(minutesAgo(12))] });
    await expect(result).resolves.toEqual(['PAN-1: 0 follow-up outcome(s)']);
    expect(file).toHaveBeenCalledTimes(1);
    expect(file).toHaveBeenCalledWith('PAN-1', wsA);
  });

  it('waits for a merge.completed at least 10 minutes old', async () => {
    const { result, file } = run({ [wsA]: [delivered(minutesAgo(8)), merged(minutesAgo(5))] });
    await result;
    expect(file).not.toHaveBeenCalled();
  });

  it('waits for a candidate at least 2 minutes old', async () => {
    const { result, file } = run({ [wsA]: [merged(minutesAgo(15)), delivered(minutesAgo(1))] });
    await result;
    expect(file).not.toHaveBeenCalled();
  });

  it('skips a candidate closed by feedback.followup_failed or feedback.followup_filed', async () => {
    const failed: PipelineJournalEntry = {
      at: minutesAgo(9), type: 'feedback.followup_failed', issueId: 'PAN-1', data: { kind: 'coderabbit', dedupKey: 'coderabbit-feedback:pan-1:900', reason: 'r' },
    };
    const filed: PipelineJournalEntry = { ...failed, type: 'feedback.followup_filed', data: { kind: 'coderabbit', dedupKey: 'coderabbit-feedback:pan-1:900', issueNumber: 9 } };
    const { result, file } = run({
      [wsA]: [delivered(minutesAgo(20)), merged(minutesAgo(15)), failed],
      [wsB]: [delivered(minutesAgo(20)), merged(minutesAgo(15)), filed],
    });
    await result;
    expect(file).not.toHaveBeenCalled();
  });

  it('skips an issue whose journal has no merge.completed', async () => {
    const { result, file } = run({ [wsA]: [delivered(minutesAgo(20))] });
    await result;
    expect(file).not.toHaveBeenCalled();
  });

  it('keeps going after the filer rejects for one workspace, and never throws', async () => {
    const file = vi.fn(async (issueId: string) => {
      if (issueId === 'PAN-1') throw new Error('boom');
      return [];
    });
    const { result, log } = run({
      [wsA]: [delivered(minutesAgo(20)), merged(minutesAgo(15))],
      [wsB]: [delivered(minutesAgo(20)), merged(minutesAgo(15))],
    }, file);
    await expect(result).resolves.toEqual(['PAN-2: 0 follow-up outcome(s)']);
    expect(file).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('[advisory-followup] patrol failed for PAN-1: boom');
  });
});
