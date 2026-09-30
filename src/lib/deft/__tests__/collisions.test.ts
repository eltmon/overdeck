/**
 * PAN-3943 WI-5: the Deft ownership and collision report.
 */
import { describe, expect, it } from 'vitest';
import { buildDeftCollisionReport, type DeftConcern } from '../collisions.js';
import type { DirectiveDetection } from '../detect.js';

const CONCERNS: DeftConcern[] = [
  'xbrief',
  'context',
  'agent-hooks',
  'git-hooks',
  'worktrees',
  'gates',
  'task-state',
  'review',
  'release',
  'skills',
  'workspace-settings',
];

const directive: DirectiveDetection = {
  root: '/repo',
  isDirectiveProject: true,
  coreVersion: null,
  pinnedEngine: '^0.119.10',
  managedSection: 'v3',
  agentHookFiles: ['.claude/settings.json'],
  gitHooksPath: '.githooks',
  hasGithooksDir: true,
  pointerSkills: ['deft-directive-glossary'],
  xbriefProjectDefinition: true,
  killSwitch: { present: false, overdeckOwned: false },
  permanentOptOut: false,
  killSwitchSupported: true,
};

const plain: DirectiveDetection = {
  ...directive,
  isDirectiveProject: false,
  pinnedEngine: null,
  managedSection: null,
  agentHookFiles: [],
  gitHooksPath: null,
  hasGithooksDir: false,
  pointerSkills: [],
  xbriefProjectDefinition: false,
};

const opts = { overdeckSkillNames: ['pan-swarm', 'pan-plan', 'unrelated'] };

describe('buildDeftCollisionReport', () => {
  it('covers every concern exactly once, in the fixed order', () => {
    const report = buildDeftCollisionReport(directive, opts);
    expect(report.rows.map((row) => row.concern)).toEqual(CONCERNS);
    for (const concern of CONCERNS) expect(report.text.split(`\n- ${concern}: `)).toHaveLength(2);
  });

  it('has a stable digest that changes with the detection', () => {
    const first = buildDeftCollisionReport(directive, opts);
    expect(buildDeftCollisionReport(directive, opts)).toEqual(first);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(buildDeftCollisionReport({ ...directive, gitHooksPath: null }, opts).digest).not.toBe(first.digest);
    expect(buildDeftCollisionReport({ ...directive, root: '/elsewhere' }, opts).digest).toBe(first.digest);
  });

  it('lists conflicting Deft skills whose Overdeck equivalent is installed', () => {
    const report = buildDeftCollisionReport(directive, opts);
    expect(report.skillOverlaps).toContainEqual({ deft: 'swarm', overdeck: 'pan-swarm' });
    expect(report.skillOverlaps.map((overlap) => overlap.overdeck).sort()).toEqual([
      'pan-plan',
      'pan-plan',
      'pan-swarm',
    ]);
    expect(report.text).toContain('swarm -> pan-swarm');
  });

  it('assigns the managed-mode owners', () => {
    const owners = Object.fromEntries(
      buildDeftCollisionReport(directive, opts).rows.map((row) => [row.concern, row.owner]),
    );
    expect(owners).toEqual({
      xbrief: 'overdeck',
      context: 'deft',
      'agent-hooks': 'deft',
      'git-hooks': 'deft',
      worktrees: 'overdeck',
      gates: 'overdeck',
      'task-state': 'overdeck',
      review: 'overdeck',
      release: 'overdeck',
      skills: 'shared-read-only',
      'workspace-settings': 'overdeck',
    });
    expect(buildDeftCollisionReport(directive, opts).rows.find((row) => row.concern === 'git-hooks')?.deft).toContain(
      'core.hooksPath .githooks',
    );
  });

  it('renders every row with deft absent for a non-Directive project', () => {
    const report = buildDeftCollisionReport(plain, opts);
    expect(report.rows).toHaveLength(CONCERNS.length);
    for (const row of report.rows) expect(row.deft).toBe('absent');
    expect(report.text.startsWith('Directive project: no\n')).toBe(true);
  });
});
