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
  notifyPipelineSync: (event: unknown) => notifySpy(event),
}));

const {
  appendPipelineEntry,
  lastPipelineEntry,
  pipelineJournalPath,
  readPipelineJournal,
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

  it('honours limit by keeping the newest entries', () => {
    for (const type of ['review.requested', 'review.dispatched', 'review.verdict'] as const) {
      appendPipelineEntry(workspace, { type, issueId: 'PAN-1' });
    }
    expect(readPipelineJournal(workspace, { limit: 2 }).map((e) => e.type))
      .toEqual(['review.dispatched', 'review.verdict']);
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
