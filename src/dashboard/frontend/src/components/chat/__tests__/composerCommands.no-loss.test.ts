import {
  COMPOSER_COMMAND_MANIFEST,
  COMPOSER_COMMAND_VARIANTS,
  getHarnessBehavior,
} from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';
import { isComposerCommandMessage } from '../../../../../../lib/composer-commands/router';
import preAdapterCommands from './fixtures/slash-commands.pre-adapter.json';

interface LegacyCommand {
  label: string;
  insert: string;
}

type MappingRow =
  | { legacy: string; kind: 'overdeck'; target: string }
  | { legacy: string; kind: 'native'; target: string }
  | { legacy: string; kind: 'alias'; target: string }
  | { legacy: string; kind: 'excluded'; reason: string };

const PRE_ADAPTER_COMMANDS = preAdapterCommands as LegacyCommand[];
const HANDOFF_ALIASES = ['/handoff', '/pan-handoff', '/pan handoff'] as const;
const PORTABLE_OVERDECK_LABELS = new Set([
  ...COMPOSER_COMMAND_MANIFEST.map(entry => entry.display),
  ...COMPOSER_COMMAND_VARIANTS.map(variant => variant.display),
]);
const CLAUDE_NATIVE_LABELS = new Set(
  getHarnessBehavior('claude-code').nativeCommands?.map(command => command.name) ?? [],
);

const MAPPING_ROWS: MappingRow[] = [
  ...PRE_ADAPTER_COMMANDS.map((command): MappingRow => {
    if (command.label === 'pan admin specialists discovery-ready') {
      return {
        legacy: command.label,
        kind: 'excluded',
        reason: 'The convoy now launches at review dispatch, so discovery-ready has no valid action.',
      };
    }
    if (command.label === '/handoff') {
      return { legacy: command.label, kind: 'alias', target: '/handoff' };
    }
    if (command.label.startsWith('/')) {
      return { legacy: command.label, kind: 'native', target: command.label };
    }
    return {
      legacy: command.label,
      kind: 'overdeck',
      target: `/${command.label}`,
    };
  }),
  { legacy: '/pan-handoff', kind: 'alias', target: '/pan-handoff' },
  { legacy: '/pan handoff', kind: 'alias', target: '/pan handoff' },
];

function unaccountedEntries(
  inventory: readonly string[],
  rows: readonly MappingRow[],
): string[] {
  return inventory.filter(legacy => !rows.some(row => row.legacy === legacy));
}

function invalidMappings(rows: readonly MappingRow[]): MappingRow[] {
  return rows.filter(row => {
    if (row.kind === 'overdeck') return !PORTABLE_OVERDECK_LABELS.has(row.target);
    if (row.kind === 'native') return !CLAUDE_NATIVE_LABELS.has(row.target);
    if (row.kind === 'alias') return !isComposerCommandMessage(row.target);
    return row.reason.trim().length === 0;
  });
}

describe('composer command no-loss audit', () => {
  const completeInventory = [
    ...PRE_ADAPTER_COMMANDS.map(command => command.label),
    ...HANDOFF_ALIASES.filter(alias => alias !== '/handoff'),
  ];

  it('accounts for every frozen legacy entry and handoff alias exactly once', () => {
    expect(PRE_ADAPTER_COMMANDS).toHaveLength(262);
    expect(new Set(MAPPING_ROWS.map(row => row.legacy)).size).toBe(MAPPING_ROWS.length);
    expect(unaccountedEntries(completeInventory, MAPPING_ROWS)).toEqual([]);
    expect(invalidMappings(MAPPING_ROWS)).toEqual([]);
  });

  it('fails closed when a legacy entry loses its mapping row', () => {
    const missingStart = MAPPING_ROWS.filter(row => row.legacy !== 'pan start');

    expect(unaccountedEntries(completeInventory, missingStart)).toContain('pan start');
  });

  it('requires every exclusion row to carry an explicit reason', () => {
    const invalidExclusion: MappingRow = {
      legacy: 'removed command',
      kind: 'excluded',
      reason: '',
    };

    expect(invalidMappings([...MAPPING_ROWS, invalidExclusion])).toContain(invalidExclusion);
  });

  it('keeps all three handoff aliases intercepted by the dashboard', () => {
    for (const alias of HANDOFF_ALIASES) {
      expect(isComposerCommandMessage(`${alias} preserve this focus`)).toBe(true);
    }
    expect(isComposerCommandMessage('/handoffish ordinary text')).toBe(false);
  });
});
