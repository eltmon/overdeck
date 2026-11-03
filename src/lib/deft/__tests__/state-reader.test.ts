/**
 * PAN-4849 WI-1: the fs-only Deft state reader against the fixture tree and
 * its hand-written golden state.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const isNativeDirectiveProject = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../archive.js', () => ({ isNativeDirectiveProject }));

const { clearDeftModeCache, readDeftIssueState, summarizeDeftIssueState } = await import('../state-reader.js');

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/directive', import.meta.url));
const GOLDEN = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/deft-issue-state.golden.json', import.meta.url)), 'utf8'));
const FIXED_NOW = Date.parse('2026-11-02T18:00:00Z');
const notNative = { isNativeDirectiveProject: async () => false };

const scratch = mkdtempSync(join(tmpdir(), 'deft-state-reader-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('readDeftIssueState', () => {
  it('parses the fixture tree into the golden state', async () => {
    expect(await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW, notNative)).toEqual(GOLDEN);
  });

  it('records a malformed escalation in errors and keeps every other escalation', async () => {
    const state = await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW, notNative);
    expect(state.errors).toEqual(['.deft/escalations/esc-bad.json: invalid JSON']);
    expect(state.escalations.map(escalation => escalation.id)).toEqual([
      'esc-20261102120000-aaaaaa',
      'esc-20261102120100-bbbbbb',
      'esc-20261102120200-cccccc',
      'esc-20261101120000-dddddd',
    ]);
  });

  it('reads an empty directory as an empty, not-installed state', async () => {
    const empty = mkdtempSync(join(scratch, 'empty-'));
    const state = await readDeftIssueState(empty, 'PAN-2', FIXED_NOW, notNative);
    expect(state).toEqual({
      issueId: 'PAN-2',
      pipeline: 'deft',
      mode: 'not-installed',
      scopes: [],
      escalations: [],
      heartbeats: [],
      decisions: [],
      approvedScopes: [],
      policy: { raw: {}, requireHumanMerge: 'unknown', reviewers: null, minGreptileConfidence: 4 },
      specDrift: { unresolved: [] },
      installDrift: [],
      liftConflicts: [],
      finishLoop: [],
      gateRuns: [],
      reviewerConfigPresent: false,
      cleanRecords: [],
      errors: [],
    });
  });

  it('reports a native Directive project and survives a failing native check', async () => {
    const native = await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW, { isNativeDirectiveProject: async () => true });
    expect(native.mode).toBe('directive-project');
    const failing = await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW, {
      isNativeDirectiveProject: async () => {
        throw new Error('not a git repository');
      },
    });
    expect(failing.mode).toBe('not-installed');
  });
});

describe('memoized native-project check (PAN-4849 review)', () => {
  beforeEach(() => {
    clearDeftModeCache();
    isNativeDirectiveProject.mockReset();
    isNativeDirectiveProject.mockResolvedValue(true);
  });

  it('runs the git-backed check once per worktree until the memo is cleared', async () => {
    expect((await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW)).mode).toBe('directive-project');
    await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW);
    expect(isNativeDirectiveProject).toHaveBeenCalledTimes(1);
    clearDeftModeCache(FIXTURE_DIR);
    await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW);
    expect(isNativeDirectiveProject).toHaveBeenCalledTimes(2);
  });

  it('does not memoize a failed check', async () => {
    isNativeDirectiveProject.mockRejectedValueOnce(new Error('git timed out'));
    expect((await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW)).mode).toBe('not-installed');
    expect((await readDeftIssueState(FIXTURE_DIR, 'PAN-1', FIXED_NOW)).mode).toBe('directive-project');
  });
});

describe('summarizeDeftIssueState', () => {
  it('counts scopes, drift and open escalations', () => {
    expect(summarizeDeftIssueState(GOLDEN)).toEqual({
      issueId: 'PAN-1',
      scopeCounts: { proposed: 1, pending: 1, active: 1, completed: 1, cancelled: 1 },
      specDriftUnresolved: 1,
      installDrift: 0,
      handoffState: 'pr_open',
      openEscalations: 3,
    });
  });

  it('omits empty folders and falls back to the last scope with a handoff state', () => {
    const completedOnly = { ...GOLDEN, scopes: GOLDEN.scopes.filter((scope: { folder: string }) => scope.folder === 'completed') };
    expect(summarizeDeftIssueState(completedOnly)).toMatchObject({ scopeCounts: { completed: 1 }, handoffState: 'delivered' });
  });
});
