/**
 * PAN-5371 · C-SIMPLE — needsYouCards.ts unit tests (pure, no rendering).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentSnapshot } from '@overdeck/contracts';
import { deriveSimpleIssue, type SimpleIssueDerivation } from './derive';
import { coveredIssueIds, issueIdOfItem, simpleNeedsYouCards, simpleSecondarySections } from './needsYouCards';
import type { NeedsYouItem } from '../selectors/needsYou';
import type { BackendPane, DerivedIssueState, DerivedIssueStateName, Issue } from '../../types';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'PAN-1',
    identifier: 'PAN-1',
    title: 'Do the thing',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: '',
    state: 'in_progress',
    ...overrides,
  } as Issue;
}

const agent = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  id: 'agent-1',
  issueId: 'PAN-1',
  status: 'running',
  role: 'work',
  ...overrides,
});

const derived = (state: DerivedIssueStateName, over: Partial<DerivedIssueState> = {}): DerivedIssueState => ({
  issueId: 'PAN-1',
  state,
  ...over,
});

const pane = (role: BackendPane['role'], state: BackendPane['state'] = 'working'): BackendPane => ({
  id: `pane-${role}`,
  issue: 'PAN-1',
  role,
  harness: 'claude-code',
  model: 'claude-opus-5',
  state,
});

function item(overrides: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return {
    key: 'issue:PAN-1',
    kind: 'issue',
    title: 'Do the thing',
    ask: 'Waiting on your input',
    open: vi.fn(),
    ...overrides,
  };
}

function byId(...derivations: SimpleIssueDerivation[]): Map<string, SimpleIssueDerivation> {
  return new Map(derivations.map((d) => [d.issue.identifier.toLowerCase(), d]));
}

describe('issueIdOfItem', () => {
  it('reads the upper-cased id from an issue: key, else undefined', () => {
    expect(issueIdOfItem(item({ key: 'issue:pan-9' }))).toBe('PAN-9');
    expect(issueIdOfItem(item({ key: 'conversation:x' }))).toBeUndefined();
  });
});

describe('simpleNeedsYouCards', () => {
  it('maps an issue item whose derivation needs you to its Simple reason', () => {
    const question = deriveSimpleIssue(
      makeIssue(),
      [agent({ pendingAskUserQuestion: { toolUseId: 't', askedAt: '', questions: [] } })],
      derived('working'),
      [pane('work')],
    );
    const startWork = deriveSimpleIssue(
      makeIssue({ identifier: 'PAN-2' }),
      [],
      { ...derived('planned'), issueId: 'PAN-2' },
      [],
    );

    const cards = simpleNeedsYouCards(
      [item({ key: 'issue:PAN-1' }), item({ key: 'issue:PAN-2' })],
      byId(question, startWork),
    );

    expect(cards[0].card).toBe('question');
    expect(cards[0].derivation).toBe(question);
    expect(cards[1].card).toBe('start-work');
    expect(cards[1].derivation).toBe(startWork);
  });

  it('maps an issue item with a subject but no needs-you display to a question card', () => {
    const working = deriveSimpleIssue(makeIssue(), [agent()], derived('working', { attention: 'needs-you' }), [pane('work')]);
    expect(working.display.state).toBe('working');

    const cards = simpleNeedsYouCards(
      [item({ key: 'issue:PAN-1', subject: {} as NeedsYouItem['subject'] })],
      byId(working),
    );

    expect(cards[0].card).toBe('question');
    expect(cards[0].derivation).toBe(working);
  });

  it('maps non-issue items and issue items without a derivation to item cards', () => {
    const cards = simpleNeedsYouCards(
      [
        item({ key: 'conversation:x', kind: 'pending-input', title: 'Helper conversation' }),
        item({ key: 'decision:y', kind: 'decision', title: 'Disk is low' }),
        item({ key: 'flywheel:z', kind: 'flywheel', title: 'Flywheel' }),
        item({ key: 'issue:PAN-404', title: 'PAN-404' }),
      ],
      byId(),
    );

    expect(cards.every((c) => c.card === 'item')).toBe(true);
    expect(cards[0].title).toBe('Helper conversation');
    expect(cards[1].title).toBe('Disk is low');
    expect(cards[2].title).toBe('A decision is waiting');
    expect(cards[3].title).toBe('PAN-404');
  });

  it('splits displaced reasons into ready-to-start and trouble', () => {
    const startWork = deriveSimpleIssue(makeIssue({ identifier: 'PAN-1' }), [], derived('planned'), []);
    const stuck = deriveSimpleIssue(makeIssue({ identifier: 'PAN-2' }), [agent({ status: 'stuck', issueId: 'PAN-2' })], derived('working', { issueId: 'PAN-2' }), [pane('work')]);
    const problems = deriveSimpleIssue(makeIssue({ identifier: 'PAN-3' }), [], derived('changes-requested', { issueId: 'PAN-3' }), []);
    const question = deriveSimpleIssue(
      makeIssue({ identifier: 'PAN-4' }),
      [agent({ issueId: 'PAN-4', pendingAskUserQuestion: { toolUseId: 't', askedAt: '', questions: [] } })],
      derived('working', { issueId: 'PAN-4' }),
      [pane('work')],
    );

    const bucketNeedsYou = [
      { derivation: startWork, kind: 'start-work' as const },
      { derivation: stuck, kind: 'stuck' as const },
      { derivation: problems, kind: 'problems' as const },
      { derivation: question, kind: 'question' as const },
    ];

    const sections = simpleSecondarySections(bucketNeedsYou, []);

    expect(sections.readyToStart).toEqual([startWork]);
    expect(sections.trouble).toEqual([
      { derivation: stuck, kind: 'stuck' },
      { derivation: problems, kind: 'problems' },
    ]);
    expect(sections.trouble.some((t) => t.derivation === question)).toBe(false);
    expect(sections.readyToStart.includes(question)).toBe(false);
  });

  it('collects covered issue ids from issue items only', () => {
    const covered = coveredIssueIds([
      item({ key: 'issue:PAN-1' }),
      item({ key: 'conversation:x' }),
      item({ key: 'flywheel:z' }),
    ]);
    expect(covered).toEqual(new Set(['PAN-1']));
  });

  it('leaves out displaced issues that are already Needs-you cards', () => {
    const startWork = deriveSimpleIssue(makeIssue({ identifier: 'pan-7' }), [], derived('planned', { issueId: 'pan-7' }), []);
    const bucketNeedsYou = [{ derivation: startWork, kind: 'start-work' as const }];

    const sections = simpleSecondarySections(bucketNeedsYou, [item({ key: 'issue:PAN-7' })]);

    expect(sections.readyToStart).toEqual([]);
    expect(sections.trouble).toEqual([]);
  });
});
