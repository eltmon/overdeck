import { describe, expect, it } from 'vitest';
import preAdapterCommands from './fixtures/slash-commands.pre-adapter.json';
import { SLASH_COMMANDS } from '../slashCommands';

interface LegacyCommand {
  label: string;
  insert: string;
}

const PRE_ADAPTER_COMMANDS = preAdapterCommands as LegacyCommand[];
const RETIRED_LEGACY_COMMANDS = new Set([
  'pan admin specialists discovery-ready',
]);

const LEGACY_TO_PORTABLE_MAPPINGS = PRE_ADAPTER_COMMANDS
  .filter(command => !RETIRED_LEGACY_COMMANDS.has(command.label))
  .map(command => {
    if (!command.label.startsWith('pan ')) {
      return { legacy: command, portable: command };
    }
    return {
      legacy: command,
      portable: {
        label: `/${command.label}`,
        insert: `/${command.label}${command.insert.endsWith(' ') ? ' ' : ''}`,
      },
    };
  });

function findMissingMappings(commands: readonly { label: string; insert: string }[]) {
  return LEGACY_TO_PORTABLE_MAPPINGS.filter(({ portable }) =>
    !commands.some(candidate =>
      candidate.label === portable.label && candidate.insert === portable.insert));
}

describe('slash command no-loss audit', () => {
  it('maps every pre-adapter command to its portable equivalent', () => {
    expect(PRE_ADAPTER_COMMANDS).toHaveLength(262);
    expect(findMissingMappings(SLASH_COMMANDS)).toEqual([]);
  });

  it('detects when a mapped legacy convenience is dropped', () => {
    const withoutShowCv = SLASH_COMMANDS.filter(command => command.insert !== '/pan show --cv');

    expect(findMissingMappings(withoutShowCv)).toContainEqual({
      legacy: { label: 'pan show --cv', insert: 'pan show  --cv' },
      portable: { label: '/pan show --cv', insert: '/pan show --cv' },
    });
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

  it('includes portable operator-critical commands', () => {
    for (const label of ['/pan strike', '/pan swarm', '/pan pause']) {
      expect(SLASH_COMMANDS.some(command => command.label === label)).toBe(true);
    }
    for (const prefix of ['/pan flywheel ', '/pan merge ', '/pan task ', '/pan release ']) {
      expect(SLASH_COMMANDS.some(command => command.label.startsWith(prefix))).toBe(true);
    }
  });
});
