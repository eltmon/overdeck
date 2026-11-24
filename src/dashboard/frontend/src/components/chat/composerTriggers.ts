/**
 * Pure helpers for the composer's three inline triggers (PAN-5662): `/`
 * commands, `@` files and `$` skills. No React, no Lexical, no DOM.
 *
 * A trigger opens a menu only at a word start (position 0 or after
 * whitespace), so `foo@bar.com`, `foo$bar` and `src/` open nothing. `/`
 * reads the whole text and its filter may contain spaces; `@` and `$` read
 * the text before the caret and their token never contains whitespace. A `$`
 * token is a skill trigger only while its filter is empty or a lowercase-led
 * skill-name prefix, so `$HOME` and `$5` stay plain text.
 */
import type { HarnessSkillMention } from '@overdeck/contracts';

import { baseName, parentPath } from '../explorer/tree/explorer-tree-model';
import type { SlashCommand } from './slashCommandTypes';

export type ComposerTriggerChar = '/' | '@' | '$';

export interface TriggerContext {
  char: ComposerTriggerChar;
  /** Index of the trigger character in the text. */
  index: number;
  /** Text typed after the trigger character. */
  filter: string;
}

const WORD_START = /\s/;
const SKILL_FILTER = /^[a-z][a-z0-9._:-]*$/;
const TRAILING_TOKEN = /\S*$/;

export function isWordStart(text: string, index: number): boolean {
  return index === 0 || WORD_START.test(text[index - 1] ?? '');
}

/** `/` over the whole text: the last `/` at a word start; filter = rest of text (may contain spaces). */
export function slashTriggerContext(text: string): TriggerContext | null {
  for (let index = text.lastIndexOf('/'); index !== -1; index = index === 0 ? -1 : text.lastIndexOf('/', index - 1)) {
    if (isWordStart(text, index)) return { char: '/', index, filter: text.slice(index + 1) };
  }
  return null;
}

/** Empty, or a lowercase-led skill-name prefix: /^[a-z][a-z0-9._:-]*$/. */
export function isSkillFilter(filter: string): boolean {
  return filter === '' || SKILL_FILTER.test(filter);
}

/**
 * `@` or `$` over the text before the caret: the trailing whitespace-free
 * token, if it starts with `char` at a word start. `$` also requires
 * isSkillFilter(filter).
 */
export function mentionTriggerContext(beforeCaret: string, char: '@' | '$'): TriggerContext | null {
  const token = TRAILING_TOKEN.exec(beforeCaret)?.[0] ?? '';
  if (!token.startsWith(char)) return null;
  const index = beforeCaret.length - token.length;
  if (!isWordStart(beforeCaret, index)) return null;
  const filter = token.slice(1);
  if (char === '$' && !isSkillFilter(filter)) return null;
  return { char, index, filter };
}

export function fileMentionInsert(rootRelativePath: string): string {
  return `@${rootRelativePath} `;
}

export function skillMentionInsert(name: string, form: HarnessSkillMention): string {
  return form === 'slash' ? `/${name} ` : `$${name} `;
}

/** Rows for the $ menu from the / menu's skill commands (label '/<name>'), name-substring filtered. */
export function toSkillMentionItems(
  skillCommands: readonly SlashCommand[],
  form: HarnessSkillMention,
  filter: string,
): SlashCommand[] {
  const needle = filter.toLowerCase();
  const rows: SlashCommand[] = [];
  for (const command of skillCommands) {
    const name = command.label.startsWith('/') ? command.label.slice(1) : command.label;
    if (!name.toLowerCase().includes(needle)) continue;
    const insert = skillMentionInsert(name, form);
    rows.push({
      id: `mention-${name}`,
      label: insert.trimEnd(),
      description: command.description,
      insert,
      category: 'Skills',
    });
  }
  return rows;
}

/** Rows for the @ menu: label baseName(path), description parentPath(path), insert fileMentionInsert(path). */
export function toFileMentionItems(paths: readonly string[]): SlashCommand[] {
  return paths.map(path => ({
    id: `file-${path}`,
    label: baseName(path),
    description: parentPath(path),
    insert: fileMentionInsert(path),
    category: 'Files',
  }));
}

/** The default composer placeholder: 'Ask anything', then the supported triggers in @, $, / order. */
export function composerPromptHint(triggers: { files: boolean; skills: boolean; commands: boolean }): string {
  const parts: string[] = [];
  if (triggers.files) parts.push('@ files');
  if (triggers.skills) parts.push('$ skills');
  if (triggers.commands) parts.push('/ commands');
  return parts.length === 0 ? 'Ask anything' : `Ask anything. ${parts.join(', ')}`;
}
