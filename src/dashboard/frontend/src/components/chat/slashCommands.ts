import {
  COMPOSER_COMMAND_INSERT_OVERRIDES,
  COMPOSER_COMMAND_MANIFEST,
  COMPOSER_COMMAND_VARIANTS,
  getHarnessBehavior,
  type HarnessName,
} from '@overdeck/contracts';
import type { SlashCommand } from './slashCommandTypes';

/** Dashboard-owned entries that are not pan CLI commands and cannot be generated. */
const STATIC_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'handoff',
    label: '/handoff',
    description: 'Open the handoff dialog for this conversation (trailing text becomes focus)',
    insert: '/handoff ',
    category: 'Conversation',
  },
];

const OVERDECK_SLASH_COMMANDS: SlashCommand[] = COMPOSER_COMMAND_MANIFEST.map(entry => {
  const commandPath = entry.path.join(' ');
  return {
    id: entry.id,
    label: entry.display,
    description: entry.description,
    insert: COMPOSER_COMMAND_INSERT_OVERRIDES[commandPath]
      ?? `${entry.display}${entry.args.length > 0 ? ' ' : ''}`,
    category: 'Overdeck',
  };
});

const CURATED_OVERDECK_VARIANTS: SlashCommand[] = COMPOSER_COMMAND_VARIANTS.map(variant => ({
  id: variant.id,
  label: variant.display,
  description: variant.description,
  insert: variant.insert,
  category: 'Overdeck',
}));

export function getSlashCommands(harness: HarnessName): SlashCommand[] {
  const behavior = getHarnessBehavior(harness);
  const nativeCommands = (behavior.nativeCommands ?? []).map(command => ({
    id: `native-${harness}-${command.name.slice(1)}`,
    label: command.name,
    description: command.description,
    insert: command.insert,
    category: `${behavior.displayName} native`,
  }));
  return [
    ...nativeCommands,
    ...STATIC_SLASH_COMMANDS,
    ...OVERDECK_SLASH_COMMANDS,
    ...CURATED_OVERDECK_VARIANTS,
  ];
}

/** Backward-compatible default for static imports and Claude Code tests. */
export const SLASH_COMMANDS: SlashCommand[] = getSlashCommands('claude-code');

export type { SlashCommand };
