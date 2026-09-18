import { describe, expect, it, vi } from 'vitest';
import {
  isIssueTerminal,
  reconcileTerminalIssueResidue,
  type ParkedResiduePatrolDeps,
  type TerminalIssueSignal,
} from '../parked-residue.js';
import type { ProjectConfig } from '../../projects.js';

function signal(issueId: string, overrides: Partial<TerminalIssueSignal> = {}): TerminalIssueSignal {
  return { issueId, issueClosed: false, prMerged: false, ...overrides };
}

const PROJECT: ProjectConfig = { name: 'fixture', path: '/tmp/fixture-project' };

describe('isIssueTerminal (PAN-3917: the tracker and the forge own terminality)', () => {
  it('a closed tracker issue is terminal', () => {
    expect(isIssueTerminal(signal('PAN-1', { issueClosed: true }))).toBe(true);
  });

  it('a merged PR is terminal', () => {
    expect(isIssueTerminal(signal('PAN-2', { prMerged: true }))).toBe(true);
  });

  it('an open issue with no merged PR is not terminal', () => {
    expect(isIssueTerminal(signal('PAN-3'))).toBe(false);
  });
});

describe('reconcileTerminalIssueResidue', () => {
  function deps(overrides: Partial<ParkedResiduePatrolDeps> = {}): ParkedResiduePatrolDeps {
    return {
      listTerminalIssues: async () => [],
      clearGatesForIssues: () => new Map(),
      ...overrides,
    };
  }

  it('clears operator gates on a terminal issue and names it in one action message', async () => {
    const clearGatesForIssues = vi.fn((issueIds: ReadonlySet<string>) =>
      new Map(issueIds.has('PAN-100') ? [['PAN-100', ['agent-pan-100-work']]] : []));
    const actions = await reconcileTerminalIssueResidue(
      [{ config: PROJECT }],
      deps({
        listTerminalIssues: async () => [signal('PAN-100', { prMerged: true }), signal('PAN-101')],
        clearGatesForIssues,
      }),
    );

    expect(clearGatesForIssues).toHaveBeenCalledWith(new Set(['PAN-100']));
    expect(actions).toEqual([
      { message: 'Cleaned parked residue for PAN-100: cleared operator gates on 1 agent row(s)', level: 'action' },
    ]);
  });

  it('scans the agent table once for every terminal issue, not once per issue', async () => {
    const clearGatesForIssues = vi.fn(() => new Map());
    await reconcileTerminalIssueResidue(
      [{ config: PROJECT }, { config: { name: 'other', path: '/tmp/other' } }],
      deps({
        listTerminalIssues: async (project) => project.name === 'fixture'
          ? [signal('PAN-1', { issueClosed: true })]
          : [signal('MIN-2', { prMerged: true })],
        clearGatesForIssues,
      }),
    );
    expect(clearGatesForIssues).toHaveBeenCalledTimes(1);
    expect(clearGatesForIssues).toHaveBeenCalledWith(new Set(['PAN-1', 'MIN-2']));
  });

  it('warns and continues when one project cannot be read', async () => {
    const actions = await reconcileTerminalIssueResidue(
      [{ config: PROJECT }, { config: { name: 'other', path: '/tmp/other' } }],
      deps({
        listTerminalIssues: async (project) => {
          if (project.name === 'fixture') throw new Error('tracker unreachable');
          return [signal('MIN-2', { prMerged: true })];
        },
        clearGatesForIssues: () => new Map([['MIN-2', ['agent-min-2-work']]]),
      }),
    );
    expect(actions[0]).toEqual({ message: 'Failed to read issue state for fixture: tracker unreachable', level: 'warn' });
    expect(actions[1].message).toContain('MIN-2');
  });

  it('is silent when nothing is terminal', async () => {
    expect(await reconcileTerminalIssueResidue([{ config: PROJECT }], deps())).toEqual([]);
  });

  it('skips projects with no path', async () => {
    const listTerminalIssues = vi.fn(async () => []);
    await reconcileTerminalIssueResidue([{ config: { name: 'pathless' } as ProjectConfig }], deps({ listTerminalIssues }));
    expect(listTerminalIssues).not.toHaveBeenCalled();
  });
});
