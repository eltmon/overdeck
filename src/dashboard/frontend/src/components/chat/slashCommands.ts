import {
  COMPOSER_COMMAND_INSERT_OVERRIDES,
  COMPOSER_COMMAND_MANIFEST,
  COMPOSER_COMMAND_VARIANTS,
} from '@overdeck/contracts';
import type { SlashCommand } from './slashCommandTypes';

/** Entries that are not pan CLI commands and cannot be generated. */
const STATIC_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'model',
    label: '/model',
    description: 'Switch the AI model for this conversation',
    insert: '/model ',
    category: 'AI CLI',
  },
  {
    id: 'context',
    label: '/context',
    description: 'Add context from a file or URL',
    insert: '/context ',
    category: 'AI CLI',
  },
  {
    id: 'effort',
    label: '/effort',
    description: 'Set effort level (low, medium, high)',
    insert: '/effort ',
    category: 'AI CLI',
  },
  {
    id: 'cancel',
    label: '/cancel',
    description: 'Cancel the current operation',
    insert: '/cancel',
    category: 'AI CLI',
  },
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
    category: entry.category,
  };
});

const CURATED_OVERDECK_VARIANTS: SlashCommand[] = COMPOSER_COMMAND_VARIANTS.map(variant => ({
  id: variant.id,
  label: variant.display,
  description: variant.description,
  insert: variant.insert,
  category: variant.category,
}));

export const SLASH_COMMANDS: SlashCommand[] = [
  ...STATIC_SLASH_COMMANDS,
  ...OVERDECK_SLASH_COMMANDS,
  ...CURATED_OVERDECK_VARIANTS,
];

export type { SlashCommand };
