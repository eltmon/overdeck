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

// PAN-4383: a test can point project resolution at a temp project; every
// other test keeps the real resolver.
const projectOverride = vi.hoisted(() => ({ value: null as { projectPath: string } | null }));
vi.mock('../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: (issueId: string) =>
      projectOverride.value ?? actual.resolveProjectFromIssueSync(issueId),
  };
});
vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

import {
  deriveIssueState,
  getDerivedIssueState,
  loadIssueStateFacts,
  specExistsFor,
  type IssueStateFacts,
} from '../../../../src/lib/overdeck/derived-issue-state.js';
import { requestOperatorDecision } from '../../../../src/lib/cloister/operator-decision.js';

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

  it('a closed issue with a merged PR carries pr.merged true (PAN-4290)', async () => {
    const derived = await getDerivedIssueState('PAN-3917', {
      ...offline,
      readIssue: async () => ({ open: false, labels: [] }),
      readPr: async () => ({
        url: 'https://example.test/pr/1', number: 1, reviewState: 'approved' as const,
        checks: 'green' as const, mergeable: true, merged: true,
      }),
    });
    expect(derived.state).toBe('closed');
    expect(derived.pr?.merged).toBe(true);
  });

  it('an open PR carries no merged key on pr (PAN-4290)', async () => {
    const derived = await getDerivedIssueState('PAN-3917', {
      ...offline,
      readIssue: async () => ({ open: true, labels: [] }),
      readPr: async () => ({
        url: 'https://example.test/pr/1', number: 1, reviewState: 'review-requested' as const,
        checks: 'pending' as const, mergeable: null, merged: false,
      }),
    });
    expect(derived.pr).not.toHaveProperty('merged');
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

// PAN-4383: an open `pan ask` decision is the operator's move.
describe('the pipeline journal owns an open operator decision', () => {
  const idleWithUnpushedWork = {
    panes: [{
      id: 'w1:p1', issue: 'PAN-3917', role: 'work' as const, harness: 'claude-code',
      model: 'opus', state: 'idle' as const, stateSince: NOW - 17 * 60 * 60_000, terminalId: 'w1:p1',
    }],
    branch: { name: 'feature/pan-3917', aheadOfMain: 3, pushed: false },
  };

  it('needs you when a decision is open, even where the agent would otherwise be stuck', () => {
    expect(deriveIssueState(facts({ ...idleWithUnpushedWork, operatorDecisionOpen: true })).attention).toBe('needs-you');
  });

  it('keeps the old result when no decision is open', () => {
    expect(deriveIssueState(facts({ ...idleWithUnpushedWork, operatorDecisionOpen: false })).attention).toBe('stuck');
    expect(deriveIssueState(facts({ operatorDecisionOpen: false })).attention).toBeUndefined();
  });
});

describe('the loader reads an open operator decision from the workspace journal (PAN-4383)', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'derived-issue-state-decision-'));
    projectOverride.value = { projectPath };
  });

  afterEach(() => {
    projectOverride.value = null;
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('carries operatorDecisionOpen true while the issue workspace has an open decision', async () => {
    const workspace = join(projectPath, 'workspaces', 'feature-pan-3917');
    mkdirSync(workspace, { recursive: true });
    requestOperatorDecision(workspace, {
      issueId: 'PAN-3917', agentId: 'agent-pan-3917', question: 'Rotate the token?', options: ['Yes', 'No'],
    });

    const loaded = await loadIssueStateFacts('PAN-3917', { ...offline, readIssue: async () => ({ open: true, labels: [] }) });

    expect(loaded.operatorDecisionOpen).toBe(true);
    expect(deriveIssueState(loaded).attention).toBe('needs-you');
  });

  it('carries operatorDecisionOpen false when the workspace journal has none', async () => {
    const loaded = await loadIssueStateFacts('PAN-3917', { ...offline, readIssue: async () => ({ open: true, labels: [] }) });

    expect(loaded.operatorDecisionOpen).toBe(false);
  });
});
