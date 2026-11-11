import { describe, expect, it } from 'vitest';

import {
  formatNoTransition,
  jiraStatusMap,
  jiraStatusToCanonical,
  pickJiraTransition,
  type JiraTransition,
} from '../../../../src/lib/tracker/jira-status.js';

const transition = (id: string, name: string, toName: string, category: string): JiraTransition => ({
  id,
  name,
  to: { name: toName, statusCategory: { key: category } },
});

const defaultMap = jiraStatusMap();

describe('jiraStatusMap', () => {
  it('uses the state-mapping defaults and leaves in_planning unset', () => {
    expect(defaultMap.todo).toBe('To Do');
    expect(defaultMap.in_review).toBe('In Review');
    expect(defaultMap.in_planning).toBeUndefined();
  });

  it('merges the project status_map over the defaults', () => {
    const map = jiraStatusMap({ status_map: { in_review: 'Code Review', in_planning: 'Planning' } });
    expect(map.in_review).toBe('Code Review');
    expect(map.in_planning).toBe('Planning');
    expect(map.done).toBe('Done');
  });
});

describe('jiraStatusToCanonical', () => {
  it('prefers a name match over the category', () => {
    expect(jiraStatusToCanonical('Done', 'indeterminate', defaultMap)).toBe('done');
  });

  it('maps In Review to in_review, not verifying_on_main', () => {
    expect(jiraStatusToCanonical('In Review', 'indeterminate', defaultMap)).toBe('in_review');
  });

  it('matches names case-insensitively', () => {
    expect(jiraStatusToCanonical('in progress', undefined, defaultMap)).toBe('in_progress');
  });

  it('falls back to the category for an unknown name', () => {
    expect(jiraStatusToCanonical('Doing It', 'indeterminate', defaultMap)).toBe('in_progress');
    expect(jiraStatusToCanonical('Shipped', 'done', defaultMap)).toBe('done');
    expect(jiraStatusToCanonical('Triage', 'new', defaultMap)).toBe('todo');
  });

  it('falls back to todo with no name match and no category', () => {
    expect(jiraStatusToCanonical('Mystery', undefined, defaultMap)).toBe('todo');
  });
});

describe('pickJiraTransition', () => {
  const transitions = [
    transition('11', 'Start', 'In Progress', 'indeterminate'),
    transition('21', 'Send to review', 'Code Review', 'indeterminate'),
    transition('31', 'Finish', 'Closed', 'done'),
  ];

  it('returns already when the issue is in the wanted status', () => {
    expect(pickJiraTransition('In Progress', transitions, 'in_progress', defaultMap)).toEqual({ kind: 'already' });
  });

  it('uses a custom status_map for both the read and the write', () => {
    const map = jiraStatusMap({ status_map: { in_review: 'Code Review' } });
    expect(jiraStatusToCanonical('Code Review', 'indeterminate', map)).toBe('in_review');
    expect(pickJiraTransition('In Progress', transitions, 'in_review', map)).toEqual({ kind: 'transition', id: '21', toName: 'Code Review' });
  });

  it('picks the only done-category transition for target done', () => {
    expect(pickJiraTransition('In Progress', transitions, 'done', defaultMap)).toEqual({ kind: 'transition', id: '31', toName: 'Closed' });
  });

  it('refuses to guess between two indeterminate transitions', () => {
    const choice = pickJiraTransition('To Do', [
      transition('11', 'Start', 'Working', 'indeterminate'),
      transition('12', 'Block', 'Blocked', 'indeterminate'),
    ], 'in_progress', defaultMap);
    expect(choice.kind).toBe('no-transition');
  });

  it('reports every available transition when none reaches canceled', () => {
    const choice = pickJiraTransition('In Progress', transitions, 'canceled', defaultMap);
    expect(choice).toEqual({
      kind: 'no-transition',
      wanted: 'Canceled',
      available: [
        { id: '11', name: 'Start', toName: 'In Progress' },
        { id: '21', name: 'Send to review', toName: 'Code Review' },
        { id: '31', name: 'Finish', toName: 'Closed' },
      ],
    });
    if (choice.kind !== 'no-transition') throw new Error('expected no-transition');
    expect(formatNoTransition('PROJ-7', choice)).toBe(
      'Jira PROJ-7: no transition reaches "Canceled" (available: Start → In Progress, Send to review → Code Review, Finish → Closed); status left unchanged.',
    );
  });

  it('treats an unmapped in_planning target as already, so nothing is written', () => {
    expect(pickJiraTransition('To Do', transitions, 'in_planning', defaultMap)).toEqual({ kind: 'already' });
  });
});
