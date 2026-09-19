/**
 * PAN-2908 · C-ACTIONS conformance tests.
 *
 * - six fixed groups, fixed order
 * - Merge is a first-class registry entry (phase-primary at READY_TO_MERGE)
 * - registry hygiene: no dead endpoints (each endpoint exists in the server
 *   route table), upload disabled with reason
 * - state filtering: contradictory verbs are never co-enabled, and no issue
 *   state enables more than 12 actions (the acceptance ceiling)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GROUP_LABELS,
  GROUP_ORDER,
  ISSUE_ACTIONS,
  getEnabledActions,
  getPhasePrimaryActions,
  type IssueActionEntry,
  type IssueActionState,
} from '../issueActions';

const byKey = new Map(ISSUE_ACTIONS.map((a) => [a.key, a]));

describe('C-ACTIONS · six groups', () => {
  it('has exactly six groups in fixed order', () => {
    expect(GROUP_ORDER).toEqual(['communicate', 'lifecycle', 'recover', 'inspect', 'navigation', 'danger']);
    expect(Object.keys(GROUP_LABELS)).toEqual(GROUP_ORDER);
  });

  it('spot-checks group membership', () => {
    expect(byKey.get('tell')?.group).toBe('communicate');
    expect(byKey.get('plan')?.group).toBe('lifecycle');
    expect(byKey.get('startAgent')?.group).toBe('lifecycle');
    expect(byKey.get('syncMain')?.group).toBe('recover');
    expect(byKey.get('recoverAgent')?.group).toBe('recover');
    expect(byKey.get('tasks')?.group).toBe('inspect');
    expect(byKey.get('viewPr')?.group).toBe('navigation');
    expect(byKey.get('wipe')?.group).toBe('danger');
    expect(byKey.get('stopAgent')?.group).toBe('danger');
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
  it('syncDiscussions points at the real command-deck route', () => {
    expect(byKey.get('syncDiscussions')?.endpoint).toBe('/api/command-deck/planning/:id/sync-discussions');
    expect(byKey.get('syncDiscussions')?.kind).toBe('safe');
  });

  it('upload is explicitly unavailable (not a stub dialog)', () => {
    expect(byKey.get('upload')?.enabledWhen(baseState())).toBe(false);
  });

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
const OPEN_PR = { url: 'https://example.test/pr/1', number: 1, reviewState: 'APPROVED', checks: 'green' as const, mergeable: true };

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
const enabledNonDangerKeys = (state: IssueActionState) => getEnabledActions(state).filter((a) => a.group !== 'danger').map((a) => a.key);
// C-ACTIONS ceiling: at most 12 enabled non-danger actions in any state.
// Danger items sit behind their collapsed submenu with their own count.

describe('C-ACTIONS · state filtering', () => {
  it('backlog issue: planning paths enabled, agent verbs disabled, ≤12 enabled', () => {
    const state = baseState();
    const keys = enabledKeys(state);
    expect(keys).toContain('plan');
    expect(keys).toContain('startSkipPlanning');
    expect(keys).not.toContain('tell');
    expect(keys).not.toContain('stopAgent');
    expect(keys).not.toContain('pause');
    expect(keys).not.toContain('merge');
    expect(enabledNonDangerKeys(state).length).toBeLessThanOrEqual(12);
  });

  it('work running: agent verbs enabled, start/plan disabled, ≤12 enabled', () => {
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
    expect(enabledNonDangerKeys(state).length).toBeLessThanOrEqual(12);
  });

  it('ready to merge: merge + viewPr enabled, work verbs disabled, ≤12 enabled', () => {
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
    expect(enabledNonDangerKeys(state).length).toBeLessThanOrEqual(12);
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
      REVIEW_RUNNING: baseState({ derived: { issueId: 'PAN-1', state: 'in-review', pr: { ...OPEN_PR, reviewState: 'REVIEW_REQUIRED', checks: 'pending' } }, hasPlan: true, hasTasks: true, issueCanonicalState: 'in_review', workspace: ws }),
      CHANGES_REQUESTED: baseState({ derived: { issueId: 'PAN-1', state: 'changes-requested', pr: { ...OPEN_PR, reviewState: 'CHANGES_REQUESTED', checks: 'red' } }, hasPlan: true, hasTasks: true, issueCanonicalState: 'in_review', workspace: ws }),
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
          "autoPlan",
          "startSkipPlanning",
          "resetIssue",
          "wipe",
          "cancel",
          "syncDiscussions",
          "createWorkspace",
        ],
        "CHANGES_REQUESTED": [
          "restartReview",
          "syncMain",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "viewPr",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "restartFromPlan",
        ],
        "MERGED": [
          "syncMain",
          "reopen",
          "closeOut",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "syncDiscussions",
          "copySettings",
        ],
        "PLANNED": [
          "startAgent",
          "requestReview",
          "syncMain",
          "rebuildAndStart",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "restartFromPlan",
        ],
        "READY_TO_MERGE": [
          "syncMain",
          "merge",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "viewPr",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "restartFromPlan",
        ],
        "REVIEW_RUNNING": [
          "restartReview",
          "syncMain",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "viewPr",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "restartFromPlan",
        ],
        "WORK_IDLE": [
          "startAgent",
          "requestReview",
          "recoverAgent",
          "syncMain",
          "rebuildAndStart",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "completeWorkReset",
          "restartFromPlan",
          "restartAgent",
        ],
        "WORK_PAUSED": [
          "tell",
          "stopAgent",
          "unpause",
          "syncMain",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "completeWorkReset",
          "restartFromPlan",
          "restartAgent",
        ],
        "WORK_RUNNING": [
          "tell",
          "stopAgent",
          "pause",
          "syncMain",
          "resetIssue",
          "wipe",
          "destroyWorkspace",
          "open",
          "cancel",
          "tasks",
          "syncDiscussions",
          "copySettings",
          "completeWorkReset",
          "restartFromPlan",
          "restartAgent",
        ],
      }
    `);
  });
});
