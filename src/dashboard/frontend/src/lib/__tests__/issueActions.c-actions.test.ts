/**
 * PAN-2908 · C-ACTIONS conformance tests (PAN-4198 reshaped the groups).
 *
 * - four fixed groups, fixed order
 * - Merge is a first-class registry entry (phase-primary at READY_TO_MERGE)
 * - registry hygiene: no dead endpoints (each endpoint exists in the server
 *   route table)
 * - state filtering: contradictory verbs are never co-enabled, and no issue
 *   state puts more than 10 actions in a menu (the PAN-4198 ceiling)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GROUP_LABELS,
  GROUP_ORDER,
  ISSUE_ACTIONS,
  getEnabledActions,
  getMenuActions,
  getPhasePrimaryActions,
  type IssueActionEntry,
  type IssueActionState,
} from '../issueActions';

const byKey = new Map(ISSUE_ACTIONS.map((a) => [a.key, a]));

describe('C-ACTIONS · four groups', () => {
  it('has exactly four groups in fixed order', () => {
    expect(GROUP_ORDER).toEqual(['communicate', 'lifecycle', 'inspect', 'danger']);
    expect(Object.keys(GROUP_LABELS)).toEqual(GROUP_ORDER);
  });

  it('spot-checks group membership', () => {
    expect(byKey.get('tell')?.group).toBe('communicate');
    expect(byKey.get('plan')?.group).toBe('lifecycle');
    expect(byKey.get('startAgent')?.group).toBe('lifecycle');
    // PAN-4198: 'recover' folded into lifecycle, 'navigation' into inspect.
    expect(byKey.get('syncMain')?.group).toBe('lifecycle');
    expect(byKey.get('recoverAgent')?.group).toBe('lifecycle');
    expect(byKey.get('stopAgent')?.group).toBe('lifecycle');
    expect(byKey.get('tasks')?.group).toBe('inspect');
    expect(byKey.get('viewPr')?.group).toBe('inspect');
    expect(byKey.get('resetIssue')?.group).toBe('danger');
    expect(byKey.get('reopen')?.group).toBe('lifecycle');
  });

  it('every action belongs to a declared group', () => {
    for (const action of ISSUE_ACTIONS) {
      expect(GROUP_ORDER, action.key).toContain(action.group);
    }
  });
});

describe('C-ACTIONS · merge in the registry', () => {
  it('merge is a first-class entry in Lifecycle, phase-primary at READY_TO_MERGE', () => {
    const merge = byKey.get('merge');
    expect(merge).toBeDefined();
    expect(merge?.group).toBe('lifecycle');
    expect(merge?.kind).toBe('safe');
    expect(merge?.endpoint).toBe('/api/issues/:id/merge');
    expect(merge?.phasePrimary).toEqual(['READY_TO_MERGE']);
  });

  it('merge is offered as a phase-primary action at READY_TO_MERGE', () => {
    const primaries = getPhasePrimaryActions({} as IssueActionState, 'READY_TO_MERGE').map((a) => a.key);
    expect(primaries).toContain('merge');
    expect(primaries).toContain('viewPr');
  });

  it('merge is enabled only when isReadyToMerge and not already merged', () => {
    const base = baseState();
    expect(byKey.get('merge')!.enabledWhen(base)).toBe(false);
    expect(byKey.get('merge')!.enabledWhen({ ...base, derived: { issueId: 'PAN-1', state: 'ready' } })).toBe(true);
    expect(byKey.get('merge')!.enabledWhen({ ...base, derived: { issueId: 'PAN-1', state: 'merged' } })).toBe(false);
  });
});

describe('C-ACTIONS · registry hygiene', () => {
  it('every registered endpoint exists in the server route table', () => {
    const routesDir = join(__dirname, '../../../../server/routes');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (entry.endsWith('.ts')) files.push(p);
      }
    };
    walk(routesDir);
    const table = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const normalizeParams = (s: string) =>
      s.replace(/:issueId/g, ':P').replace(/:agentId/g, ':P').replace(/:taskId/g, ':P').replace(/:itemId/g, ':P').replace(/:id/g, ':P');
    const tableNorm = normalizeParams(table);
    for (const action of ISSUE_ACTIONS) {
      if (!action.endpoint) continue;
      const path = normalizeParams(action.endpoint.split('?')[0]);
      const found = tableNorm.includes(path);
      expect(found, `${action.key} → ${action.endpoint} has no server route`).toBe(true);
    }
  });
});

const WORK_PANE = [{ id: 'pane-work', issue: 'PAN-1', role: 'work' as const, harness: 'claude-code', model: 'claude-opus-5', state: 'working' as const }];
const OPEN_PR = { url: 'https://example.test/pr/1', number: 1, reviewState: 'approved', checks: 'green' as const, mergeable: true };

function baseState(overrides: Partial<IssueActionState> = {}): IssueActionState {
  return {
    derived: null,
    agent: null,
    lifecycle: null,
    workspace: { exists: false, issueId: 'PAN-1' } as IssueActionState['workspace'],
    hasPlan: false,
    hasTasks: false,
    issueCanonicalState: 'todo',
    isMerged: false,
    hasPr: false,
    prUrl: null,
    ...overrides,
  };
}

const enabledKeys = (state: IssueActionState) => getEnabledActions(state).map((a) => a.key);
// PAN-4198 ceiling: a menu never lists more than 10 actions in any state.
// Menus render only enabled, menu-placed entries, so this counts what the
// operator actually sees, Danger rows included.
const menuKeys = (state: IssueActionState) => getMenuActions(state).map((a) => a.key);

describe('C-ACTIONS · state filtering', () => {
  it('backlog issue: planning paths enabled, agent verbs disabled, ≤10 in the menu', () => {
    const state = baseState();
    const keys = enabledKeys(state);
    expect(keys).toContain('plan');
    expect(keys).not.toContain('tell');
    expect(keys).not.toContain('stopAgent');
    expect(keys).not.toContain('pause');
    expect(keys).not.toContain('merge');
    expect(menuKeys(state).length).toBeLessThanOrEqual(10);
  });

  it('work running: agent verbs enabled, start/plan disabled, ≤10 in the menu', () => {
    const state = baseState({
      agent: { status: 'running', role: 'work' } as IssueActionState['agent'],
      derived: { issueId: 'PAN-1', state: 'working' },
      panes: WORK_PANE,
      hasPlan: true,
      hasTasks: true,
      issueCanonicalState: 'in_progress',
      workspace: { exists: true, issueId: 'PAN-1' } as IssueActionState['workspace'],
    });
    const keys = enabledKeys(state);
    expect(keys).toContain('tell');
    expect(keys).toContain('doneWork');
    expect(keys).toContain('stopAgent');
    expect(keys).toContain('pause');
    expect(keys).not.toContain('startAgent');
    expect(keys).not.toContain('plan');
    expect(keys).not.toContain('unpause');
    expect(menuKeys(state).length).toBeLessThanOrEqual(10);
  });

  it('ready to merge: merge + viewPr enabled, work verbs disabled, ≤10 in the menu', () => {
    const state = baseState({
      derived: { issueId: 'PAN-1', state: 'ready', pr: OPEN_PR },
      hasPlan: true,
      hasTasks: true,
      issueCanonicalState: 'in_review',
      workspace: { exists: true, issueId: 'PAN-1' } as IssueActionState['workspace'],
    });
    const keys = enabledKeys(state);
    expect(keys).toContain('merge');
    expect(keys).toContain('viewPr');
    expect(keys).not.toContain('doneWork');
    expect(keys).not.toContain('startAgent');
    expect(menuKeys(state).length).toBeLessThanOrEqual(10);
  });

  it('merged: closeOut offered, merge never offered twice', () => {
    const keys = enabledKeys(baseState({
      derived: { issueId: 'PAN-1', state: 'merged' },
      isMerged: true,
      issueCanonicalState: 'done',
      workspace: { exists: true, issueId: 'PAN-1' } as IssueActionState['workspace'],
    }));
    expect(keys).toContain('closeOut');
    expect(keys).not.toContain('merge');
  });

  it('contradictory verbs are never co-enabled across representative states', () => {
    const states: IssueActionState[] = [
      baseState(),
      baseState({ agent: { status: 'running', role: 'work' } as IssueActionState['agent'], hasPlan: true, hasTasks: true, issueCanonicalState: 'in_progress' }),
      baseState({ agent: { status: 'stopped', role: 'work' } as IssueActionState['agent'], hasPlan: true, hasTasks: true, issueCanonicalState: 'in_progress' }),
      baseState({ agent: { status: 'running', role: 'work', paused: true } as IssueActionState['agent'], hasPlan: true, hasTasks: true, issueCanonicalState: 'in_progress' }),
      baseState({ derived: { issueId: 'PAN-1', state: 'ready', pr: OPEN_PR }, issueCanonicalState: 'in_review' }),
      baseState({ derived: { issueId: 'PAN-1', state: 'merged' }, isMerged: true, issueCanonicalState: 'done' }),
    ];
    const contradictions: [string, string][] = [
      ['startAgent', 'stopAgent'],
      ['pause', 'unpause'],
      ['plan', 'doneWork'],
      ['merge', 'startAgent'],
    ];
    for (const state of states) {
      const keys = new Set(enabledKeys(state));
      for (const [a, b] of contradictions) {
        expect(keys.has(a) && keys.has(b), `${a} + ${b} co-enabled`).toBe(false);
      }
    }
  });
});

describe('C-ACTIONS · enabled-set snapshot per phase (§3.9 gate)', () => {
  it('snapshots the enabled action set for every representative phase', () => {
    const ws = { exists: true, issueId: 'PAN-1' } as IssueActionState['workspace'];
    const workAgent = (status: string, extra: Record<string, unknown> = {}) =>
      ({ status, role: 'work', ...extra }) as IssueActionState['agent'];
    const phases: Record<string, IssueActionState> = {
      BACKLOG: baseState(),
      PLANNED: baseState({ hasPlan: true, hasTasks: true, workspace: ws }),
      WORK_RUNNING: baseState({ agent: workAgent('running'), hasPlan: true, hasTasks: true, issueCanonicalState: 'in_progress', workspace: ws }),
      WORK_IDLE: baseState({ agent: workAgent('stopped'), hasPlan: true, hasTasks: true, issueCanonicalState: 'in_progress', workspace: ws }),
      WORK_PAUSED: baseState({ agent: workAgent('running', { paused: true }), hasPlan: true, hasTasks: true, issueCanonicalState: 'in_progress', workspace: ws }),
      REVIEW_RUNNING: baseState({ derived: { issueId: 'PAN-1', state: 'in-review', pr: { ...OPEN_PR, reviewState: 'review-requested', checks: 'pending' } }, hasPlan: true, hasTasks: true, issueCanonicalState: 'in_review', workspace: ws }),
      CHANGES_REQUESTED: baseState({ derived: { issueId: 'PAN-1', state: 'changes-requested', pr: { ...OPEN_PR, reviewState: 'changes-requested', checks: 'red' } }, hasPlan: true, hasTasks: true, issueCanonicalState: 'in_review', workspace: ws }),
      READY_TO_MERGE: baseState({ derived: { issueId: 'PAN-1', state: 'ready', pr: OPEN_PR }, hasPlan: true, hasTasks: true, issueCanonicalState: 'in_review', workspace: ws }),
      MERGED: baseState({ derived: { issueId: 'PAN-1', state: 'merged' }, isMerged: true, issueCanonicalState: 'done', workspace: ws }),
    };
    const snapshot = Object.fromEntries(
      Object.entries(phases).map(([phase, state]) => [phase, enabledKeys(state)]),
    );
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "BACKLOG": [
          "plan",
          "cancel",
          "createWorkspace",
        ],
        "CHANGES_REQUESTED": [
          "restartReview",
          "syncMain",
          "resetIssue",
          "cancel",
          "open",
          "viewPr",
          "tasks",
        ],
        "MERGED": [
          "reopen",
          "closeOut",
          "destroyWorkspace",
          "open",
        ],
        "PLANNED": [
          "startAgent",
          "syncMain",
          "rebuildAndStart",
          "resetIssue",
          "cancel",
          "open",
          "tasks",
        ],
        "READY_TO_MERGE": [
          "syncMain",
          "merge",
          "resetIssue",
          "cancel",
          "open",
          "viewPr",
          "tasks",
        ],
        "REVIEW_RUNNING": [
          "restartReview",
          "syncMain",
          "resetIssue",
          "cancel",
          "open",
          "viewPr",
          "tasks",
        ],
        "WORK_IDLE": [
          "startAgent",
          "recoverAgent",
          "restartAgent",
          "syncMain",
          "rebuildAndStart",
          "resetIssue",
          "cancel",
          "open",
          "tasks",
        ],
        "WORK_PAUSED": [
          "tell",
          "stopAgent",
          "unpause",
          "restartAgent",
          "resetIssue",
          "cancel",
          "open",
          "tasks",
        ],
        "WORK_RUNNING": [
          "tell",
          "stopAgent",
          "pause",
          "restartAgent",
          "resetIssue",
          "cancel",
          "open",
          "tasks",
        ],
      }
    `);
  });
});
