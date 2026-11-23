/**
 * The append-only per-issue pipeline journal.
 *
 * The contract under test is narrow on purpose: append, read, last-by-prefix,
 * one event per append, and a write failure that never reaches the caller.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifySpy = vi.fn();
vi.mock('../../pipeline-notifier.js', () => ({
  notifyPipeline: (event: unknown) => notifySpy(event),
}));

const {
  appendPipelineEntry,
  lastPipelineEntry,
  lastPipelineStep,
  openStackReclaim,
  reclaimedInEpisode,
  pipelineJournalPath,
  readPipelineJournal,
  tryReadPipelineJournal,
} = await import('../pipeline-journal.js');

let workspace: string;

beforeEach(() => {
  notifySpy.mockClear();
  workspace = mkdtempSync(join(tmpdir(), 'pipeline-journal-'));
});

afterEach(() => {
  try { chmodSync(join(workspace, '.overdeck'), 0o755); } catch { /* not every case locks it */ }
  rmSync(workspace, { recursive: true, force: true });
});

describe('appendPipelineEntry', () => {
  it('creates the runtime dir and the file on the first append', () => {
    expect(existsSync(join(workspace, '.overdeck'))).toBe(false);

    const entry = appendPipelineEntry(workspace, {
      type: 'verification.started',
      issueId: 'PAN-1',
      source: 'pan-done',
      data: { head: 'a7b64f7' },
    });

    expect(existsSync(pipelineJournalPath(workspace))).toBe(true);
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readFileSync(pipelineJournalPath(workspace), 'utf-8').endsWith('\n')).toBe(true);
  });

  it('round-trips entries in append order', () => {
    appendPipelineEntry(workspace, { type: 'review.requested', issueId: 'PAN-1', source: 'pan-done' });
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-1', data: { launched: 4 } });

    const entries = readPipelineJournal(workspace);
    expect(entries.map((e) => e.type)).toEqual(['review.requested', 'review.dispatched']);
    expect(entries[1].data).toEqual({ launched: 4 });
  });

  it('fires one pipeline.entry event per append', () => {
    const entry = appendPipelineEntry(workspace, { type: 'merge.attempted', issueId: 'PAN-2' });
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith({ type: 'pipeline.entry', issueId: 'PAN-2', entry });
  });

  it('never throws when the journal cannot be written, and still fires the event', () => {
    mkdirSync(join(workspace, '.overdeck'), { recursive: true });
    chmodSync(join(workspace, '.overdeck'), 0o500);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const entry = appendPipelineEntry(workspace, { type: 'verification.failed', issueId: 'PAN-3' });

    expect(entry.type).toBe('verification.failed');
    expect(warn).toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('readPipelineJournal', () => {
  it('returns an empty list when nothing was ever appended', () => {
    expect(readPipelineJournal(workspace)).toEqual([]);
  });

  it('skips a malformed line instead of failing the whole read', () => {
    appendPipelineEntry(workspace, { type: 'review.requested', issueId: 'PAN-1' });
    appendFileSync(pipelineJournalPath(workspace), '{"at":"2026-01-01T00:00:00Z","typ\n', 'utf-8');
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-1' });

    expect(readPipelineJournal(workspace).map((e) => e.type)).toEqual(['review.requested', 'review.dispatched']);
  });

  it('starts a fresh line after a torn last line, so the next entry is not lost (#4035 review)', () => {
    appendPipelineEntry(workspace, { type: 'uat.verdict', issueId: 'PAN-1', data: { status: 'failed' } });
    // A crash mid-write: a partial line with no trailing newline.
    appendFileSync(pipelineJournalPath(workspace), '{"at":"2026-01-01T00:00:00Z","type":"uat.ver', 'utf-8');
    appendPipelineEntry(workspace, { type: 'uat.verdict', issueId: 'PAN-1', data: { status: 'passed' } });

    expect(readPipelineJournal(workspace).map((e) => e.data?.status)).toEqual(['failed', 'passed']);
    expect(readFileSync(pipelineJournalPath(workspace), 'utf-8').endsWith('\n')).toBe(true);
  });

  it('adds no blank line when the file already ends in a newline', () => {
    appendPipelineEntry(workspace, { type: 'review.requested', issueId: 'PAN-1' });
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-1' });

    expect(readFileSync(pipelineJournalPath(workspace), 'utf-8').split('\n')).toHaveLength(3);
  });

  it('honours limit by keeping the newest entries', () => {
    for (const type of ['review.requested', 'review.dispatched', 'review.verdict'] as const) {
      appendPipelineEntry(workspace, { type, issueId: 'PAN-1' });
    }
    expect(readPipelineJournal(workspace, { limit: 2 }).map((e) => e.type))
      .toEqual(['review.dispatched', 'review.verdict']);
  });
});

describe('tryReadPipelineJournal (PAN-5648 journal-read-null.ac1)', () => {
  it('returns null when the journal path is a directory, but readPipelineJournal falls back to []', () => {
    mkdirSync(pipelineJournalPath(workspace), { recursive: true });

    expect(tryReadPipelineJournal(workspace)).toBeNull();
    expect(readPipelineJournal(workspace)).toEqual([]);
  });

  it('returns [] from both when the journal is simply missing', () => {
    expect(tryReadPipelineJournal(workspace)).toEqual([]);
    expect(readPipelineJournal(workspace)).toEqual([]);
  });
});

describe('lastPipelineEntry', () => {
  it('returns the last entry overall with no prefix', () => {
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-1' });
    appendPipelineEntry(workspace, { type: 'verification.failed', issueId: 'PAN-1' });
    expect(lastPipelineEntry(workspace)?.type).toBe('verification.failed');
  });

  it('returns the last entry matching a prefix', () => {
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-1' });
    appendPipelineEntry(workspace, { type: 'verification.failed', issueId: 'PAN-1' });
    expect(lastPipelineEntry(workspace, 'review.')?.type).toBe('review.dispatched');
    expect(lastPipelineEntry(workspace, 'merge.')).toBeNull();
  });

  it('is null for a workspace with no journal', () => {
    expect(lastPipelineEntry(workspace)).toBeNull();
  });
});

describe('housekeeping entries (PAN-5623)', () => {
  it('lastPipelineEntry without a prefix skips a trailing stack.reclaimed', () => {
    appendPipelineEntry(workspace, { type: 'blocked.declared', issueId: 'PAN-1' });
    appendPipelineEntry(workspace, { type: 'stack.reclaimed', issueId: 'PAN-1' });
    expect(lastPipelineEntry(workspace)?.type).toBe('blocked.declared');
  });

  it('lastPipelineEntry with the stack. prefix still finds the reclaim', () => {
    appendPipelineEntry(workspace, { type: 'blocked.declared', issueId: 'PAN-1' });
    appendPipelineEntry(workspace, { type: 'stack.reclaimed', issueId: 'PAN-1' });
    expect(lastPipelineEntry(workspace, 'stack.')?.type).toBe('stack.reclaimed');
  });

  it('lastPipelineEntry without a prefix is null when only stack.* entries exist', () => {
    appendPipelineEntry(workspace, { type: 'stack.reclaimed', issueId: 'PAN-1' });
    appendPipelineEntry(workspace, { type: 'stack.restored', issueId: 'PAN-1' });
    expect(lastPipelineEntry(workspace)).toBeNull();
  });

  it('lastPipelineStep returns the entry before a trailing stack.restored', () => {
    const entries = [
      { at: '2026-11-23T00:00:00.000Z', type: 'review.requested' as const, issueId: 'PAN-1' },
      { at: '2026-11-23T00:00:01.000Z', type: 'stack.reclaimed' as const, issueId: 'PAN-1' },
      { at: '2026-11-23T00:00:02.000Z', type: 'stack.restored' as const, issueId: 'PAN-1' },
    ];
    expect(lastPipelineStep(entries)?.type).toBe('review.requested');
    expect(lastPipelineStep(entries.slice(1))).toBeNull();
  });
});

describe('openStackReclaim and reclaimedInEpisode (PAN-5623)', () => {
  const at = (n: number) => `2026-11-23T00:00:0${n}.000Z`;
  const reclaim = (n: number, data: Record<string, unknown>) =>
    ({ at: at(n), type: 'stack.reclaimed' as const, issueId: 'PAN-1', data });

  it('returns the reclaim when a pipeline step follows it', () => {
    const entries = [
      reclaim(0, { containers: ['myn-feature-min-1144-api-1', 'myn-feature-min-1144-fe-1'], composeProject: 'myn-feature-min-1144' }),
      { at: at(1), type: 'verification.started' as const, issueId: 'PAN-1' },
    ];
    expect(openStackReclaim(entries)).toEqual({
      at: at(0),
      containers: ['myn-feature-min-1144-api-1', 'myn-feature-min-1144-fe-1'],
      composeProject: 'myn-feature-min-1144',
    });
  });

  it('is null when a restore follows the reclaim', () => {
    const entries = [
      reclaim(0, { containers: ['a-api-1'] }),
      { at: at(1), type: 'stack.restored' as const, issueId: 'PAN-1' },
    ];
    expect(openStackReclaim(entries)).toBeNull();
  });

  it('returns the second reclaim when restored then reclaimed again', () => {
    const entries = [
      reclaim(0, { containers: ['a-api-1'] }),
      { at: at(1), type: 'stack.restored' as const, issueId: 'PAN-1' },
      reclaim(2, { containers: ['a-fe-1'] }),
    ];
    expect(openStackReclaim(entries)).toEqual({ at: at(2), containers: ['a-fe-1'], composeProject: null });
  });

  it('is null for a reclaim with no usable container names', () => {
    expect(openStackReclaim([reclaim(0, { containers: [] })])).toBeNull();
    expect(openStackReclaim([reclaim(0, { containers: [1, '', null] })])).toBeNull();
    expect(openStackReclaim([reclaim(0, {})])).toBeNull();
  });

  it('reclaimedInEpisode matches only the same episodeSince', () => {
    const entries = [reclaim(0, { containers: ['a-api-1'], episodeSince: '2026-11-23T00:00:00.000Z' })];
    expect(reclaimedInEpisode(entries, '2026-11-23T00:00:00.000Z')).toBe(true);
    expect(reclaimedInEpisode(entries, '2026-11-23T01:00:00.000Z')).toBe(false);
    expect(reclaimedInEpisode([], '2026-11-23T00:00:00.000Z')).toBe(false);
  });
});
