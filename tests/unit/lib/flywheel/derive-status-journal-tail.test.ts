/**
 * PAN-5648 (CodeRabbit r4672667750): `readFlywheelJournalTail` must drop
 * `stack.*` housekeeping entries before taking the last 50, not after — a
 * `limit`-at-read-time tail can be entirely housekeeping once 50+ of those
 * trail the journal, which silently lost the real pipeline entry (e.g.
 * `blocked.declared`) the Flywheel needed to see.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendPipelineEntry } from '../../../../src/lib/cloister/pipeline-journal.js';
import { readFlywheelJournalTail } from '../../../../src/lib/flywheel/derive-status.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flywheel-journal-tail-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('readFlywheelJournalTail', () => {
  it('keeps a real pipeline entry behind 60 trailing housekeeping entries (PAN-5648 journal-tail-filter.ac1)', async () => {
    appendPipelineEntry(workspace, { type: 'blocked.declared', issueId: 'PAN-1', data: { item: 'wi1', blockers: ['PAN-2'] } });
    for (let i = 0; i < 60; i += 1) {
      appendPipelineEntry(workspace, { type: 'stack.reclaimed', issueId: 'PAN-1', data: { containers: [`c${i}`] } });
    }

    const tail = await readFlywheelJournalTail(workspace);

    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({ type: 'blocked.declared', issueId: 'PAN-1' });
  });

  it('returns the last 50 of 70 real pipeline entries, in order (PAN-5648 journal-tail-filter.ac2)', async () => {
    for (let i = 0; i < 70; i += 1) {
      appendPipelineEntry(workspace, { type: 'merge.attempted', issueId: 'PAN-1', data: { seq: i } });
    }

    const tail = await readFlywheelJournalTail(workspace);

    expect(tail).toHaveLength(50);
    expect(tail.map((entry) => entry.data?.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 20));
  });
});
