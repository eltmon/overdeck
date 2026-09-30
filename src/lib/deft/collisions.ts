/**
 * Deft ownership and collision report (PAN-3943 WI-5): one owner per concern
 * where a Deft deposit and Overdeck both have a say, rendered as stable plain
 * text. The sha256 of that text is the plan digest managed mode stores, so the
 * text holds no timestamps or paths and keeps a fixed row order.
 */
import { createHash } from 'node:crypto';
import { DEFT_SKILL_MAP } from '../skill-packs/deft.js';
import type { DirectiveDetection } from './detect.js';

export type DeftConcern =
  | 'xbrief'
  | 'context'
  | 'agent-hooks'
  | 'git-hooks'
  | 'worktrees'
  | 'gates'
  | 'task-state'
  | 'review'
  | 'release'
  | 'skills'
  | 'workspace-settings';

export interface CollisionRow {
  concern: DeftConcern;
  deft: string;
  overdeck: string;
  owner: 'overdeck' | 'deft' | 'shared-read-only';
  note: string;
}

export interface DeftCollisionReport {
  rows: CollisionRow[];
  skillOverlaps: Array<{ deft: string; overdeck: string }>;
  text: string;
  digest: string;
}

const ABSENT = 'absent';

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function buildRows(d: DirectiveDetection, overlaps: DeftCollisionReport['skillOverlaps']): CollisionRow[] {
  const deft = (value: string): string => (d.isDirectiveProject ? value : ABSENT);
  return [
    {
      concern: 'xbrief',
      deft: deft(`xbrief/ (PROJECT-DEFINITION ${d.xbriefProjectDefinition ? 'present' : 'absent'})`),
      overdeck: 'pipeline xBRIEF in .pan/specs',
      owner: 'overdeck',
      note: "Overdeck plans in .pan/specs; Deft's xbrief/ is left untouched.",
    },
    {
      concern: 'context',
      deft: deft(d.managedSection ? `AGENTS.md managed section ${d.managedSection}` : 'no AGENTS.md managed section'),
      overdeck: 'launch artifacts',
      owner: 'deft',
      note: 'Deft owns its AGENTS.md managed section; Overdeck delivers context through launch artifacts and never edits it.',
    },
    {
      concern: 'agent-hooks',
      deft: deft(`deft-hook in ${list(d.agentHookFiles)}`),
      overdeck: 'never edits deposit hooks',
      owner: 'deft',
      note: "Overdeck workspace creation merges its own hooks into <workspace>/.claude/settings.json.",
    },
    {
      concern: 'git-hooks',
      deft: deft(
        `core.hooksPath ${d.gitHooksPath ?? 'unset'}; .githooks/pre-commit ${d.hasGithooksDir ? 'present' : 'absent'}`,
      ),
      overdeck: 'never sets core.hooksPath',
      owner: 'deft',
      note:
        'The deposited hook scripts do not check the kill switch. Feature-branch commits pass verify:branch; ' +
        'main-branch plan-artifact commits in a Directive plan home may be refused.',
    },
    {
      concern: 'worktrees',
      deft: deft('build and swarm skills'),
      overdeck: 'workspaces/feature-<issue> worktrees',
      owner: 'overdeck',
      note: 'Overdeck creates, syncs, and removes issue worktrees.',
    },
    {
      concern: 'gates',
      deft: deft('pre-pr and verify gates'),
      overdeck: 'verification gate',
      owner: 'overdeck',
      note: 'pan done runs the verification gate.',
    },
    {
      concern: 'task-state',
      deft: deft('Deft session and task state'),
      overdeck: 'pan task and the continue file',
      owner: 'overdeck',
      note: 'Item completion is recorded by pan task done.',
    },
    {
      concern: 'review',
      deft: deft('review-cycle skill'),
      overdeck: 'review pipeline',
      owner: 'overdeck',
      note: 'Review runs from the PR after pan done.',
    },
    {
      concern: 'release',
      deft: deft('release skill (releases the deft framework)'),
      overdeck: 'merge pipeline',
      owner: 'overdeck',
      note: 'Overdeck merges; the Deft release skill is excluded from the pack.',
    },
    {
      concern: 'skills',
      deft: deft(`pointer skills ${list(d.pointerSkills)}`),
      overdeck: 'deft pack read-only allowlist',
      owner: 'shared-read-only',
      note: `Overlapping Deft skills: ${list(overlaps.map((o) => `${o.deft} -> ${o.overdeck}`))}.`,
    },
    {
      concern: 'workspace-settings',
      deft: deft('.claude/settings.json is a tracked deposit'),
      overdeck: 'merges workspace hooks into .claude/settings.json',
      owner: 'overdeck',
      note: "In a Directive project Overdeck's hook merge dirties the tracked .claude/settings.json.",
    },
  ];
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function renderText(d: DirectiveDetection, rows: readonly CollisionRow[]): string {
  const project = d.isDirectiveProject
    ? `Directive project: yes (core ${d.coreVersion ?? 'none'}, engine pin ${d.pinnedEngine ?? 'none'}, ` +
      `managed section ${d.managedSection ?? 'none'})`
    : 'Directive project: no';
  const header = { concern: 'Concern', owner: 'Owner', deft: 'Deft', overdeck: 'Overdeck' };
  const widths = {
    concern: Math.max(header.concern.length, ...rows.map((r) => r.concern.length)),
    owner: Math.max(header.owner.length, ...rows.map((r) => r.owner.length)),
    deft: Math.max(header.deft.length, ...rows.map((r) => r.deft.length)),
  };
  const line = (r: { concern: string; owner: string; deft: string; overdeck: string }): string =>
    `${pad(r.concern, widths.concern)}  ${pad(r.owner, widths.owner)}  ${pad(r.deft, widths.deft)}  ${r.overdeck}`.trimEnd();
  return [
    project,
    '',
    line(header),
    ...rows.map(line),
    '',
    'Notes:',
    ...rows.map((r) => `- ${r.concern}: ${r.note}`),
    '',
  ].join('\n');
}

export function buildDeftCollisionReport(
  d: DirectiveDetection,
  opts: { overdeckSkillNames: readonly string[] },
): DeftCollisionReport {
  const names = new Set(opts.overdeckSkillNames);
  const skillOverlaps = Object.entries(DEFT_SKILL_MAP)
    .filter(([, entry]) => entry.class === 'conflicting' && entry.overdeck !== undefined && names.has(entry.overdeck))
    .map(([deft, entry]) => ({ deft, overdeck: entry.overdeck! }))
    .sort((a, b) => a.deft.localeCompare(b.deft));
  const rows = buildRows(d, skillOverlaps);
  const text = renderText(d, rows);
  return { rows, skillOverlaps, text, digest: createHash('sha256').update(text).digest('hex') };
}
