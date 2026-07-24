import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS } from '../slashCommands';

const PRE_CHANGE_COMMANDS = [
  {
    "label": "/model",
    "insert": "/model "
  },
  {
    "label": "/context",
    "insert": "/context "
  },
  {
    "label": "/effort",
    "insert": "/effort "
  },
  {
    "label": "/cancel",
    "insert": "/cancel"
  },
  {
    "label": "pan up",
    "insert": "pan up"
  },
  {
    "label": "pan down",
    "insert": "pan down"
  },
  {
    "label": "pan reload",
    "insert": "pan reload"
  },
  {
    "label": "pan restart",
    "insert": "pan restart"
  },
  {
    "label": "pan status",
    "insert": "pan status"
  },
  {
    "label": "pan init",
    "insert": "pan init"
  },
  {
    "label": "pan sync",
    "insert": "pan sync"
  },
  {
    "label": "pan doctor",
    "insert": "pan doctor"
  },
  {
    "label": "pan update",
    "insert": "pan update"
  },
  {
    "label": "pan install",
    "insert": "pan install"
  },
  {
    "label": "pan serve",
    "insert": "pan serve"
  },
  {
    "label": "pan skills",
    "insert": "pan skills"
  },
  {
    "label": "pan test run",
    "insert": "pan test run "
  },
  {
    "label": "pan start",
    "insert": "pan start "
  },
  {
    "label": "pan tell",
    "insert": "pan tell "
  },
  {
    "label": "pan kill",
    "insert": "pan kill "
  },
  {
    "label": "pan resume",
    "insert": "pan resume "
  },
  {
    "label": "pan recover",
    "insert": "pan recover "
  },
  {
    "label": "pan sync-main",
    "insert": "pan sync-main "
  },
  {
    "label": "pan done",
    "insert": "pan done "
  },
  {
    "label": "pan reopen",
    "insert": "pan reopen "
  },
  {
    "label": "pan reset-to-planned",
    "insert": "pan reset-to-planned "
  },
  {
    "label": "pan wipe",
    "insert": "pan wipe "
  },
  {
    "label": "pan close",
    "insert": "pan close "
  },
  {
    "label": "pan plan",
    "insert": "pan plan "
  },
  {
    "label": "pan plan --auto --auto-start",
    "insert": "pan plan --auto --auto-start "
  },
  {
    "label": "pan plan finalize",
    "insert": "pan plan finalize "
  },
  {
    "label": "pan issues",
    "insert": "pan issues"
  },
  {
    "label": "pan show",
    "insert": "pan show "
  },
  {
    "label": "pan show --cv",
    "insert": "pan show  --cv"
  },
  {
    "label": "pan show --context",
    "insert": "pan show  --context"
  },
  {
    "label": "pan show --health",
    "insert": "pan show  --health"
  },
  {
    "label": "pan review pending",
    "insert": "pan review pending"
  },
  {
    "label": "pan review request",
    "insert": "pan review request "
  },
  {
    "label": "pan review reset",
    "insert": "pan review reset "
  },
  {
    "label": "pan review reset --session",
    "insert": "pan review reset  --session"
  },
  {
    "label": "pan workspace create",
    "insert": "pan workspace create "
  },
  {
    "label": "pan workspace list",
    "insert": "pan workspace list"
  },
  {
    "label": "pan workspace destroy",
    "insert": "pan workspace destroy "
  },
  {
    "label": "pan workspace update",
    "insert": "pan workspace update "
  },
  {
    "label": "pan workspace migrate",
    "insert": "pan workspace migrate "
  },
  {
    "label": "pan workspace ssh",
    "insert": "pan workspace ssh "
  },
  {
    "label": "pan workspace sync-auth",
    "insert": "pan workspace sync-auth "
  },
  {
    "label": "pan workspace start",
    "insert": "pan workspace start "
  },
  {
    "label": "pan workspace stop",
    "insert": "pan workspace stop "
  },
  {
    "label": "pan workspace add-repo",
    "insert": "pan workspace add-repo "
  },
  {
    "label": "pan admin cloister status",
    "insert": "pan admin cloister status"
  },
  {
    "label": "pan admin cloister start",
    "insert": "pan admin cloister start"
  },
  {
    "label": "pan admin cloister stop",
    "insert": "pan admin cloister stop"
  },
  {
    "label": "pan admin cloister emergency-stop",
    "insert": "pan admin cloister emergency-stop"
  },
  {
    "label": "pan admin specialists list",
    "insert": "pan admin specialists list"
  },
  {
    "label": "pan admin specialists wake",
    "insert": "pan admin specialists wake "
  },
  {
    "label": "pan admin specialists queue",
    "insert": "pan admin specialists queue "
  },
  {
    "label": "pan admin specialists reset",
    "insert": "pan admin specialists reset "
  },
  {
    "label": "pan admin specialists clear-queue",
    "insert": "pan admin specialists clear-queue "
  },
  {
    "label": "pan admin specialists done",
    "insert": "pan admin specialists done"
  },
  {
    "label": "pan admin specialists logs",
    "insert": "pan admin specialists logs"
  },
  {
    "label": "pan admin specialists cleanup-logs",
    "insert": "pan admin specialists cleanup-logs"
  },
  {
    "label": "pan project add",
    "insert": "pan project add "
  },
  {
    "label": "pan project list",
    "insert": "pan project list"
  },
  {
    "label": "pan project show",
    "insert": "pan project show "
  },
  {
    "label": "pan project remove",
    "insert": "pan project remove "
  },
  {
    "label": "pan project init",
    "insert": "pan project init"
  },
  {
    "label": "pan admin remote status",
    "insert": "pan admin remote status"
  },
  {
    "label": "pan admin remote init",
    "insert": "pan admin remote init"
  },
  {
    "label": "pan admin remote resources",
    "insert": "pan admin remote resources"
  },
  {
    "label": "pan admin remote setup",
    "insert": "pan admin remote setup"
  },
  {
    "label": "pan admin db snapshot",
    "insert": "pan admin db snapshot"
  },
  {
    "label": "pan admin db seed",
    "insert": "pan admin db seed "
  },
  {
    "label": "pan admin tasks compact",
    "insert": "pan admin tasks compact"
  },
  {
    "label": "pan admin tasks stats",
    "insert": "pan admin tasks stats"
  },
  {
    "label": "pan admin config shadow",
    "insert": "pan admin config shadow"
  },
  {
    "label": "pan admin hooks install",
    "insert": "pan admin hooks install"
  },
  {
    "label": "pan admin tldr",
    "insert": "pan admin tldr "
  },
  {
    "label": "pan admin fpp",
    "insert": "pan admin fpp "
  },
  {
    "label": "pan admin tracker linear-states",
    "insert": "pan admin tracker linear-states"
  },
  {
    "label": "pan admin tracker linear-cleanup",
    "insert": "pan admin tracker linear-cleanup"
  },
  {
    "label": "pan admin migrate-config",
    "insert": "pan admin migrate-config"
  },
  {
    "label": "/handoff",
    "insert": "/handoff "
  },
  {
    "label": "pan fork",
    "insert": "pan fork "
  },
  {
    "label": "pan fork --plain",
    "insert": "pan fork  --plain"
  },
  {
    "label": "pan handoff",
    "insert": "pan handoff "
  },
  {
    "label": "pan handoff --model",
    "insert": "pan handoff  --model "
  },
  {
    "label": "pan handoff --harness",
    "insert": "pan handoff  --harness "
  },
  {
    "label": "pan handoff --cwd",
    "insert": "pan handoff  --cwd "
  },
  {
    "label": "pan backup list",
    "insert": "pan backup list"
  },
  {
    "label": "pan backup clean",
    "insert": "pan backup clean"
  },
  {
    "label": "pan restore",
    "insert": "pan restore "
  },
  {
    "label": "pan inspect",
    "insert": "pan inspect "
  },
  {
    "label": "pan cost today",
    "insert": "pan cost today"
  },
  {
    "label": "pan cost sync",
    "insert": "pan cost sync"
  }
] as const;

const DELIBERATE_REMOVALS = [
  {
    label: 'pan admin specialists queue',
    insert: 'pan admin specialists queue ',
    reason: 'The visible CLI no longer registers pan admin specialists queue.',
  },
  {
    label: 'pan admin specialists clear-queue',
    insert: 'pan admin specialists clear-queue ',
    reason: 'The visible CLI no longer registers pan admin specialists clear-queue.',
  },
  {
    label: 'pan admin tasks compact',
    insert: 'pan admin tasks compact',
    reason: 'The visible CLI no longer has an admin tasks command group.',
  },
  {
    label: 'pan admin tasks stats',
    insert: 'pan admin tasks stats',
    reason: 'The visible CLI no longer has an admin tasks command group.',
  },
] as const;

const removedInserts = new Set(DELIBERATE_REMOVALS.map(command => command.insert));

function findMissingSurvivors(commands: readonly { insert: string }[]) {
  return PRE_CHANGE_COMMANDS.filter(command =>
    !removedInserts.has(command.insert) &&
    !commands.some(candidate => candidate.insert === command.insert));
}

function findUnexpectedRemovals(commands: readonly { insert: string }[]) {
  return DELIBERATE_REMOVALS.filter(command =>
    commands.some(candidate => candidate.insert === command.insert));
}

describe('slash command no-loss audit', () => {
  it('preserves every pre-change command that still has a visible CLI or static source', () => {
    expect(findMissingSurvivors(SLASH_COMMANDS)).toEqual([]);
  });

  it('detects when a surviving pre-change convenience is dropped', () => {
    const withoutShowCv = SLASH_COMMANDS.filter(command => command.insert !== 'pan show  --cv');

    expect(findMissingSurvivors(withoutShowCv)).toContainEqual({
      label: 'pan show --cv',
      insert: 'pan show  --cv',
    });
  });

  it('keeps deliberate removals absent and detects one parked as removed', () => {
    expect(findUnexpectedRemovals(SLASH_COMMANDS)).toEqual([]);

    expect(findUnexpectedRemovals([
      ...SLASH_COMMANDS,
      { insert: DELIBERATE_REMOVALS[0].insert },
    ])).toContainEqual(DELIBERATE_REMOVALS[0]);
  });

  it('preserves every non-CLI static entry verbatim', () => {
    const expectedStaticEntries = [
      { label: '/model', insert: '/model ' },
      { label: '/context', insert: '/context ' },
      { label: '/effort', insert: '/effort ' },
      { label: '/cancel', insert: '/cancel' },
      { label: '/handoff', insert: '/handoff ' },
    ];

    for (const expected of expectedStaticEntries) {
      expect(SLASH_COMMANDS).toContainEqual(expect.objectContaining(expected));
    }
  });

  it('includes the operator-critical commands named in PAN-3021', () => {
    for (const label of ['pan strike', 'pan swarm', 'pan pause']) {
      expect(SLASH_COMMANDS.some(command => command.label === label)).toBe(true);
    }
    for (const prefix of ['pan flywheel ', 'pan merge ', 'pan task ', 'pan release ']) {
      expect(SLASH_COMMANDS.some(command => command.label.startsWith(prefix))).toBe(true);
    }
  });
});
