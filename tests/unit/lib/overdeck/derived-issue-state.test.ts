/**
 * The one FR-6 derivation (PAN-3917), shared by `pan show` and the dashboard.
 *
 * The nine-row table itself is pinned in
 * `src/dashboard/server/services/__tests__/derived-issue-state.test.ts`, which
 * exercises the same exports through the server adapter. What matters here is
 * the loader contract: who owns each fact, and what an unanswered tracker read
 * is allowed to mean.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveIssueState,
  getDerivedIssueState,
  loadIssueStateFacts,
  loadIssueStatesForProject,
  parseFeatureBranchRefs,
  specExistsFor,
  type IssueStateFacts,
} from '../../../../src/lib/overdeck/derived-issue-state.js';

const NOW = 1_800_000_000_000;

function facts(overrides: Partial<IssueStateFacts> = {}): IssueStateFacts {
  return {
    issueId: 'PAN-3917',
    issueOpen: true,
    labels: [],
    parkedListed: false,
    specExists: false,
    panes: [],
    prMerged: false,
    apiError: false,
    now: NOW,
    ...overrides,
  };
}

/** Offline loader deps: nothing here may touch a tracker, a forge, or tmux. */
const offline = {
  now: () => NOW,
  panes: [],
  readPr: async () => null,
  readBranch: async () => null,
  readPaneText: async () => '',
};

describe('the tracker owns closed', () => {
  it('a closed issue is closed even with an open pull request', async () => {
    const derived = await getDerivedIssueState('PAN-3917', {
      ...offline,
      readIssue: async () => ({ open: false, labels: [] }),
      readPr: async () => ({
        url: 'https://example.test/pr/1', number: 1, reviewState: 'review-requested' as const,
        checks: 'pending' as const, mergeable: null, merged: false,
      }),
    });
    expect(derived.state).toBe('closed');
  });

  it('an unresolved tracker read is unknown, never open', async () => {
    const loaded = await loadIssueStateFacts('PAN-3917', { ...offline, readIssue: async () => null });
    expect(loaded.issueOpen).toBeNull();

    const derived = await getDerivedIssueState('PAN-3917', { ...offline, readIssue: async () => null });
    expect(derived.state).not.toBe('closed');
    expect(derived.trackerUnknown).toBe(true);
  });

  it('carries no unknown flag once a tracker has answered', async () => {
    const derived = await getDerivedIssueState('PAN-3917', {
      ...offline,
      readIssue: async () => ({ open: true, labels: [] }),
    });
    expect(derived.trackerUnknown).toBeUndefined();
    expect(deriveIssueState(facts({ issueOpen: true })).trackerUnknown).toBeUndefined();
  });

  it('only a tracker answer of "closed" closes the issue', () => {
    expect(deriveIssueState(facts({ issueOpen: false })).state).toBe('closed');
    expect(deriveIssueState(facts({ issueOpen: null })).state).toBe('backlog');
  });
});

describe('the plan home owns the spec', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'derived-issue-state-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  function writeSpec(root: string, name: string): void {
    const dir = join(root, '.pan', 'specs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), '{}\n', 'utf8');
  }

  it('finds the promoted, dated spec in the main checkout', () => {
    writeSpec(projectPath, '2026-07-28-PAN-1-some-feature.xbrief.json');
    expect(specExistsFor('PAN-1', projectPath)).toBe(true);
  });

  it('finds the legacy .vbrief spec name too', () => {
    writeSpec(projectPath, '2026-01-01-PAN-1-some-feature.vbrief.json');
    expect(specExistsFor('PAN-1', projectPath)).toBe(true);
  });

  it('finds the spec the planning agent wrote in the issue workspace', () => {
    writeSpec(join(projectPath, 'workspaces', 'feature-pan-1'), '2026-07-28-PAN-1-some-feature.xbrief.json');
    expect(specExistsFor('PAN-1', projectPath)).toBe(true);
  });

  it('accepts the bare <ISSUE>.xbrief.json name as well', () => {
    writeSpec(projectPath, 'PAN-1.xbrief.json');
    expect(specExistsFor('PAN-1', projectPath)).toBe(true);
  });

  it('reports no spec when neither plan home has one', () => {
    writeSpec(projectPath, '2026-07-28-PAN-2-another-issue.xbrief.json');
    expect(specExistsFor('PAN-1', projectPath)).toBe(false);
  });
});

describe('the backend owns liveness', () => {
  it('a live reviewer pane is in review even with no pull request', () => {
    const pane = {
      id: 'w1:p2', issue: 'PAN-3917', role: 'review' as const, harness: 'claude-code',
      model: 'opus', state: 'working' as const, stateSince: NOW, terminalId: 'w1:p2',
    };
    expect(deriveIssueState(facts({ panes: [pane] })).state).toBe('in-review');
  });

  it('a blocked pane is the operator\'s move', () => {
    const pane = {
      id: 'w1:p1', issue: 'PAN-3917', role: 'work' as const, harness: 'claude-code',
      model: 'opus', state: 'blocked' as const, stateSince: NOW, terminalId: 'w1:p1',
    };
    expect(deriveIssueState(facts({ panes: [pane] })).attention).toBe('needs-you');
  });
});

describe('the batch door lists branches once', () => {
  const SHA_A = 'a'.repeat(40);
  const SHA_B = 'b'.repeat(40);
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'derived-issue-state-batch-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('parses local and remote refs into one entry per local branch', () => {
    const map = parseFeatureBranchRefs([
      `refs/heads/feature/pan-1 ${SHA_A} 2 10`,
      `refs/remotes/origin/feature/pan-1 ${SHA_A} 2 10`,
      `refs/heads/feature/pan-2 ${SHA_A} 1 0`,
      `refs/remotes/origin/feature/pan-2 ${SHA_B} 3 0`,
      `refs/heads/feature/pan-3 ${SHA_B} 0 4`,
      `refs/remotes/origin/feature/pan-4 ${SHA_A} 5 0`,
      '',
    ].join('\n'));

    expect(map.get('feature/pan-1')).toEqual({ name: 'feature/pan-1', aheadOfMain: 2, pushed: true });
    expect(map.get('feature/pan-2')).toEqual({ name: 'feature/pan-2', aheadOfMain: 1, pushed: false });
    expect(map.get('feature/pan-3')).toEqual({ name: 'feature/pan-3', aheadOfMain: 0, pushed: false });
    expect(map.has('feature/pan-4')).toBe(false);
    expect(map.size).toBe(3);
  });

  it('reads the branch map once for fifty PR-less issues and never the per-issue seam', async () => {
    const issueIds = Array.from({ length: 50 }, (_, i) => `PAN-${i + 1}`);
    const readBranches = vi.fn(async () => new Map([
      ['feature/pan-1', { name: 'feature/pan-1', aheadOfMain: 2, pushed: false }],
    ]));
    const readBranch = vi.fn(async () => null);

    const states = await loadIssueStatesForProject(projectPath, issueIds, {
      now: () => NOW,
      panes: [],
      readPr: async () => null,
      readBranches,
      readBranch,
      issues: Object.fromEntries(issueIds.map((id) => [id, { open: true, labels: [] }])),
    });

    expect(readBranches).toHaveBeenCalledTimes(1);
    expect(readBranches).toHaveBeenCalledWith(projectPath);
    expect(readBranch).not.toHaveBeenCalled();
    expect(states.get('PAN-1')?.state).toBe('working');
    expect(states.get('PAN-1')?.branch).toEqual({ name: 'feature/pan-1', aheadOfMain: 2, pushed: false });
    expect(states.get('PAN-2')?.state).toBe('backlog');
    expect(states.get('PAN-2')?.branch).toBeUndefined();
  });

  it('keeps the per-issue readBranch seam when no readBranches is given', async () => {
    const issueIds = ['PAN-1', 'PAN-2', 'PAN-3'];
    const readBranch = vi.fn(async (_projectPath: string, branch: string) =>
      branch === 'feature/pan-3' ? { name: branch, aheadOfMain: 1, pushed: true } : null);

    const states = await loadIssueStatesForProject(projectPath, issueIds, {
      now: () => NOW,
      panes: [],
      readPr: async () => null,
      readBranch,
      issues: Object.fromEntries(issueIds.map((id) => [id, { open: true, labels: [] }])),
    });

    expect(readBranch).toHaveBeenCalledTimes(3);
    expect(readBranch.mock.calls.map(([, branch]) => branch))
      .toEqual(['feature/pan-1', 'feature/pan-2', 'feature/pan-3']);
    expect(states.get('PAN-3')?.state).toBe('working');
    expect(states.get('PAN-1')?.state).toBe('backlog');
  });
});
