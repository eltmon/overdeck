/**
 * PAN-4451: the blocker-wake tick wakes a work agent once every blocker of a
 * live `blocked.declared` merged, journals one `blocked.woken` per
 * declaration, and counts both from the real pipeline journal so a restart
 * never re-sends.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: () => undefined }));

import {
  __resetBlockerWakeStateForTests,
  buildBlockerWakePrompt,
  pendingDeclarations,
  tickBlockerWake,
  type BlockerWakeDeps,
} from '../blocker-wake.js';
import { formatBlockerRef, type BlockerRef } from '../blocker-refs.js';
import { appendPipelineEntry, readPipelineJournal, type PipelineJournalEntry } from '../pipeline-journal.js';

const ISSUE = 'PAN-4437';

let workspace: string;

function declare(item: string, blockers: string[]): PipelineJournalEntry {
  const entry = appendPipelineEntry(workspace, {
    type: 'blocked.declared',
    issueId: ISSUE,
    source: 'pan-task-block',
    data: { item, blockers },
  });
  vi.advanceTimersByTime(1000);
  return entry;
}

function wokenEntries(): PipelineJournalEntry[] {
  return readPipelineJournal(workspace).filter((entry) => entry.type === 'blocked.woken');
}

function makeDeps(overrides: BlockerWakeDeps = {}, statuses: Record<string, string> = {}) {
  const merged = new Set<string>(['PAN-4307', 'PAN-4436', 'eltmon/overdeck#4444']);
  const isMerged = vi.fn(async (ref: BlockerRef) => merged.has(formatBlockerRef(ref)));
  const deliver = vi.fn(async (_agentId: string, _prompt: string, _dedupKey: string) => ({ delivered: true, queuedToMail: false }));
  const surfaceNeedsYou = vi.fn(async () => undefined);
  const resolveTarget = vi.fn(async () => ({ agentId: 'agent-pan-4437' }) as const);
  const readItemStatuses = vi.fn(async () => ({ 'PAN-4437-a': 'blocked', 'PAN-4437-b': 'blocked', ...statuses }));
  const deps: BlockerWakeDeps = {
    listWorkspaces: () => [{ issueId: ISSUE, path: workspace }],
    getIssuePause: () => ({ status: 'unpaused' }),
    readItemStatuses,
    isMerged,
    resolveTarget,
    deliver,
    surfaceNeedsYou,
    log: () => undefined,
    ...overrides,
  };
  return { deps, merged, isMerged, deliver, surfaceNeedsYou, resolveTarget, readItemStatuses };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  __resetBlockerWakeStateForTests();
  workspace = mkdtempSync(join(tmpdir(), 'blocker-wake-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('pendingDeclarations', () => {
  it('keeps the newest declaration per item that no woken entry names', () => {
    const entries: PipelineJournalEntry[] = [
      { at: 't1', type: 'blocked.declared', issueId: ISSUE, data: { item: 'a', blockers: ['PAN-1'] } },
      { at: 't2', type: 'blocked.declared', issueId: ISSUE, data: { item: 'a', blockers: ['PAN-2'] } },
      { at: 't3', type: 'blocked.declared', issueId: ISSUE, data: { item: 'b', blockers: ['PAN-3'] } },
      { at: 't4', type: 'blocked.woken', issueId: ISSUE, data: { item: 'b', declaredAt: 't3', outcome: 'delivered' } },
    ];
    expect(pendingDeclarations(entries).map((entry) => entry.at)).toEqual(['t2']);
  });
});

describe('tickBlockerWake', () => {
  it('wakes the agent once when every blocker merged, and a second tick sends nothing', async () => {
    const declaration = declare('PAN-4437-a', ['PAN-4307', 'eltmon/overdeck#4444']);
    const { deps, deliver } = makeDeps();

    expect(await tickBlockerWake(deps)).toEqual([`${ISSUE}: woke agent-pan-4437 for PAN-4437-a`]);
    expect(deliver).toHaveBeenCalledTimes(1);
    const [agentId, prompt, dedupKey] = deliver.mock.calls[0];
    expect(agentId).toBe('agent-pan-4437');
    expect(prompt).toContain('BLOCKERS MERGED: PAN-4437 item(s) PAN-4437-a were blocked on PAN-4307, eltmon/overdeck#4444');
    expect(dedupKey).toBe(`blocker-wake:pan-4437:${declaration.at}`);
    expect(wokenEntries()).toEqual([expect.objectContaining({
      source: 'blocker-wake',
      data: {
        item: 'PAN-4437-a',
        declaredAt: declaration.at,
        blockers: ['PAN-4307', 'eltmon/overdeck#4444'],
        outcome: 'delivered',
        agentId: 'agent-pan-4437',
      },
    })]);

    expect(await tickBlockerWake(deps)).toEqual([]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(wokenEntries()).toHaveLength(1);
  });

  it('sends nothing while one blocker has not merged', async () => {
    declare('PAN-4437-a', ['PAN-4307', 'PAN-9999']);
    const { deps, deliver } = makeDeps();
    expect(await tickBlockerWake(deps)).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
    expect(wokenEntries()).toEqual([]);
  });

  it('sends nothing and reads no forge when the item is no longer blocked', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    const { deps, deliver, isMerged } = makeDeps({}, { 'PAN-4437-a': 'pending' });
    expect(await tickBlockerWake(deps)).toEqual([]);
    expect(isMerged).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(wokenEntries()).toEqual([]);
  });

  it('sends one message naming both items resolved in the same tick, and journals two woken entries', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    declare('PAN-4437-b', ['PAN-4436']);
    const { deps, deliver } = makeDeps();
    await tickBlockerWake(deps);
    expect(deliver).toHaveBeenCalledTimes(1);
    const prompt = deliver.mock.calls[0][1];
    expect(prompt).toContain('PAN-4437-a, PAN-4437-b');
    expect(wokenEntries().map((entry) => entry.data?.item)).toEqual(['PAN-4437-a', 'PAN-4437-b']);
  });

  it('checks only the newest declaration of a re-declared item', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    declare('PAN-4437-a', ['PAN-9999']);
    const { deps, deliver, isMerged } = makeDeps();
    await tickBlockerWake(deps);
    expect(isMerged.mock.calls.map(([ref]) => formatBlockerRef(ref))).toEqual(['PAN-9999']);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('raises Needs-you once and journals unreachable when there is no work agent', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    const { deps, deliver, surfaceNeedsYou } = makeDeps({
      resolveTarget: async () => ({ needsYou: true, reason: 'no workspace agent' }),
    });
    expect(await tickBlockerWake(deps)).toEqual([`${ISSUE}: escalated`]);
    expect(deliver).not.toHaveBeenCalled();
    expect(surfaceNeedsYou).toHaveBeenCalledTimes(1);
    expect(surfaceNeedsYou).toHaveBeenCalledWith(
      ISSUE,
      'Blockers of PAN-4437-a merged but the work agent could not be reached',
      expect.objectContaining({ items: ['PAN-4437-a'], blockers: ['PAN-4307'] }),
    );
    expect(wokenEntries()).toEqual([expect.objectContaining({ data: expect.objectContaining({ outcome: 'unreachable' }) })]);

    expect(await tickBlockerWake(deps)).toEqual([]);
    expect(surfaceNeedsYou).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown delivery as unreachable', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    const { deps, surfaceNeedsYou } = makeDeps({ deliver: async () => { throw new Error('pane gone'); } });
    expect(await tickBlockerWake(deps)).toEqual([`${ISSUE}: escalated`]);
    expect(surfaceNeedsYou).toHaveBeenCalledTimes(1);
    expect(wokenEntries()).toEqual([expect.objectContaining({ data: expect.objectContaining({ outcome: 'unreachable' }) })]);
    expect(await tickBlockerWake(deps)).toEqual([]);
    expect(surfaceNeedsYou).toHaveBeenCalledTimes(1);
  });

  it('logs a failed merge read, keeps the declaration pending, and never throws', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    const log = vi.fn();
    const { deps, deliver } = makeDeps({ isMerged: async () => { throw new Error('rate limited'); }, log });
    await expect(tickBlockerWake(deps)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith('[blocker-wake] PAN-4437: could not read PAN-4307: rate limited');
    expect(deliver).not.toHaveBeenCalled();
    expect(wokenEntries()).toEqual([]);
  });

  it('does not re-read a ref it already saw merged', async () => {
    declare('PAN-4437-a', ['PAN-4307', 'PAN-9999']);
    const { deps, merged, isMerged, deliver } = makeDeps();
    await tickBlockerWake(deps);
    expect(isMerged).toHaveBeenCalledTimes(2);
    merged.add('PAN-9999');
    await tickBlockerWake(deps);
    expect(isMerged.mock.calls.map(([ref]) => formatBlockerRef(ref))).toEqual(['PAN-4307', 'PAN-9999', 'PAN-9999']);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('reads nothing beyond the journal for a paused issue', async () => {
    declare('PAN-4437-a', ['PAN-4307']);
    const { deps, readItemStatuses, isMerged, deliver } = makeDeps({
      getIssuePause: () => ({ status: 'paused', agentId: 'agent-pan-4437', stoppedAgents: [] }),
    });
    expect(await tickBlockerWake(deps)).toEqual([]);
    expect(readItemStatuses).not.toHaveBeenCalled();
    expect(isMerged).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('buildBlockerWakePrompt', () => {
  it('names the sync-main, unblock, and re-block steps', () => {
    const prompt = buildBlockerWakePrompt({ issueId: ISSUE, items: ['PAN-4437-a'], blockers: ['PAN-4307'] });
    expect(prompt).toContain('1. Run `pan sync-main PAN-4437` to bring the merged code into this branch.');
    expect(prompt).toContain('3. Run `pan task unblock PAN-4437 <item>` for each item above, then continue with `pan task next PAN-4437`.');
    expect(prompt).toContain('pan task block PAN-4437 <item> --on <ref>');
  });
});
