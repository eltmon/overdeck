import { describe, expect, it } from 'vitest';

import {
  composerPromptHint,
  isSkillFilter,
  mentionTriggerContext,
  skillMentionInsert,
  slashTriggerContext,
  toFileMentionItems,
  toSkillMentionItems,
} from '../composerTriggers';
import type { SlashCommand } from '../slashCommandTypes';

describe('slashTriggerContext', () => {
  it('opens at position 0 with an empty filter', () => {
    expect(slashTriggerContext('/')).toEqual({ char: '/', index: 0, filter: '' });
  });

  it('keeps spaces in the filter', () => {
    expect(slashTriggerContext('/pan work')).toEqual({ char: '/', index: 0, filter: 'pan work' });
  });

  it('ignores a / inside a word', () => {
    expect(slashTriggerContext('look at src/')).toBeNull();
    expect(slashTriggerContext('and/or')).toBeNull();
  });

  it('finds a / after a space', () => {
    expect(slashTriggerContext('fix /mo')).toEqual({ char: '/', index: 4, filter: 'mo' });
  });

  it('finds a / after a newline', () => {
    expect(slashTriggerContext('a\n/b')).toEqual({ char: '/', index: 2, filter: 'b' });
  });

  it('uses the last word-start / when a later / sits inside a word', () => {
    expect(slashTriggerContext('/review src/a')).toEqual({ char: '/', index: 0, filter: 'review src/a' });
  });
});

describe('mentionTriggerContext', () => {
  it('reads an @ token at the start', () => {
    expect(mentionTriggerContext('@comp', '@')).toEqual({ char: '@', index: 0, filter: 'comp' });
  });

  it('reads an @ token with a path after a space', () => {
    expect(mentionTriggerContext('see @src/Comp', '@')).toEqual({ char: '@', index: 4, filter: 'src/Comp' });
  });

  it('ignores an @ inside a word', () => {
    expect(mentionTriggerContext('foo@bar.com', '@')).toBeNull();
  });

  it('closes once the token is followed by whitespace', () => {
    expect(mentionTriggerContext('@a b', '@')).toBeNull();
  });

  it('opens a bare $ with an empty filter', () => {
    expect(mentionTriggerContext('$', '$')).toEqual({ char: '$', index: 0, filter: '' });
  });

  it('does not treat environment variables or prices as skill triggers', () => {
    expect(mentionTriggerContext('echo $HOME', '$')).toBeNull();
    expect(mentionTriggerContext('costs $5', '$')).toBeNull();
  });

  it('ignores a $ inside a word', () => {
    expect(mentionTriggerContext('foo$bar', '$')).toBeNull();
  });

  it('reads a skill-name $ token', () => {
    expect(mentionTriggerContext('$pan-fly', '$')).toEqual({ char: '$', index: 0, filter: 'pan-fly' });
  });
});

describe('isSkillFilter', () => {
  it('accepts empty and lowercase-led names, rejects uppercase and digits', () => {
    expect(isSkillFilter('')).toBe(true);
    expect(isSkillFilter('pan-flywheel')).toBe(true);
    expect(isSkillFilter('HOME')).toBe(false);
    expect(isSkillFilter('5')).toBe(false);
  });
});

describe('skillMentionInsert', () => {
  it('writes the harness form', () => {
    expect(skillMentionInsert('docx', 'slash')).toBe('/docx ');
    expect(skillMentionInsert('docx', 'dollar')).toBe('$docx ');
  });
});

describe('toSkillMentionItems', () => {
  const skills: SlashCommand[] = [
    { id: 'skill-pan-flywheel', label: '/pan-flywheel', description: 'Run the flywheel', insert: '/pan-flywheel ', category: 'Skills' },
    { id: 'skill-docx', label: '/docx', description: 'Write files that fly', insert: '/docx ', category: 'Skills' },
  ];

  it('filters by name only, never the description', () => {
    const rows = toSkillMentionItems(skills, 'slash', 'fly');
    expect(rows.map(row => row.label)).toEqual(['/pan-flywheel']);
    expect(rows[0]).toEqual({
      id: 'mention-pan-flywheel',
      label: '/pan-flywheel',
      description: 'Run the flywheel',
      insert: '/pan-flywheel ',
      category: 'Skills',
    });
  });

  it('labels and inserts the dollar form', () => {
    const rows = toSkillMentionItems(skills, 'dollar', 'fly');
    expect(rows.map(row => [row.label, row.insert])).toEqual([['$pan-flywheel', '$pan-flywheel ']]);
  });

  it('keeps every skill for an empty filter', () => {
    expect(toSkillMentionItems(skills, 'dollar', '')).toHaveLength(2);
  });
});

describe('toFileMentionItems', () => {
  it('splits name and directory and inserts the root-relative path', () => {
    const rows = toFileMentionItems(['src/a/Composer.tsx', 'README.md']);
    expect(rows.map(row => row.label)).toEqual(['Composer.tsx', 'README.md']);
    expect(rows.map(row => row.description)).toEqual(['src/a', '']);
    expect(rows.map(row => row.insert)).toEqual(['@src/a/Composer.tsx ', '@README.md ']);
    expect(rows.map(row => row.id)).toEqual(['file-src/a/Composer.tsx', 'file-README.md']);
    expect(rows.every(row => row.category === 'Files')).toBe(true);
  });
});

describe('composerPromptHint', () => {
  it('lists the supported triggers in @, $, / order', () => {
    expect(composerPromptHint({ files: true, skills: true, commands: true })).toBe('Ask anything. @ files, $ skills, / commands');
    expect(composerPromptHint({ files: false, skills: false, commands: true })).toBe('Ask anything. / commands');
    expect(composerPromptHint({ files: true, skills: false, commands: true })).toBe('Ask anything. @ files, / commands');
    expect(composerPromptHint({ files: false, skills: false, commands: false })).toBe('Ask anything');
  });
});
