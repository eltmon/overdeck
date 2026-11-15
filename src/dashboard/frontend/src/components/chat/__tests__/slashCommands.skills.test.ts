/**
 * PAN-5347 WI-4: getSlashCommands appends skill commands last, only for
 * harnesses that declare the skillSlashCommands capability.
 */
import { describe, expect, it } from 'vitest';
import { getSlashCommands } from '../slashCommands';
import type { SlashCommand } from '../slashCommandTypes';

const skillCommand: SlashCommand = {
  id: 'skill-grilling', label: '/grilling', description: 'Grill.', insert: '/grilling ', category: 'Skills',
};

describe('getSlashCommands skill commands (PAN-5347)', () => {
  it('appends the skill command last for claude-code, keeping every earlier entry unchanged', () => {
    const withoutSkills = getSlashCommands('claude-code');
    const withSkills = getSlashCommands('claude-code', [skillCommand]);

    expect(withSkills.slice(0, -1)).toEqual(withoutSkills);
    expect(withSkills.at(-1)).toEqual(skillCommand);
  });

  it('never appends a Skills entry for an incapable harness', () => {
    const result = getSlashCommands('codex', [skillCommand]);

    expect(result.some(command => command.category === 'Skills')).toBe(false);
  });

  it('leaves Overdeck CLI entries and the native /model entry under their existing categories', () => {
    const result = getSlashCommands('claude-code', [skillCommand]);

    const overdeckEntry = result.find(command => command.label === '/pan init');
    expect(overdeckEntry?.category).toBe('Overdeck');

    const modelEntry = result.find(command => command.label === '/model');
    expect(modelEntry?.category).toBe('Claude Code native');
  });
});
