import type { SlashCommand } from './slashCommandTypes';
import { GENERATED_SLASH_COMMANDS } from './slashCommands.generated';

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

export const SLASH_COMMANDS: SlashCommand[] = [
  ...STATIC_SLASH_COMMANDS,
  ...GENERATED_SLASH_COMMANDS,
];

export type { SlashCommand };
