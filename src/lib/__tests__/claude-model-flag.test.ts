import { describe, expect, it } from 'vitest';
import { getAgentCommand, getClaudeModelFlag } from '../settings.js';

describe('getClaudeModelFlag (PAN-4160)', () => {
  it('passes an Anthropic model ID missing from the alias table through unchanged', () => {
    expect(getClaudeModelFlag('claude-haiku-5')).toBe('claude-haiku-5');
    expect(getClaudeModelFlag('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5-20250929');
  });

  it('never launches an unknown Anthropic ID as a different model', () => {
    expect(getAgentCommand('claude-haiku-5')).toEqual({
      command: 'claude',
      args: ['--model', 'claude-haiku-5'],
    });
  });

  it('keeps the table mappings for known IDs', () => {
    expect(getClaudeModelFlag('claude-haiku-4-5')).toBe('haiku');
    expect(getClaudeModelFlag('claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  // PAN-4327: Claude Code 2.1.284 resolves the short `sonnet` alias to Sonnet
  // 5.5, so every Sonnet ID must pass its full API ID through unchanged.
  it.each(['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5'])(
    'maps %s to its own full API ID, never the sonnet alias',
    (model) => {
      expect(getClaudeModelFlag(model)).toBe(model);
    },
  );

  it('launches claude-sonnet-5-5 with its full API ID', () => {
    expect(getAgentCommand('claude-sonnet-5-5')).toEqual({
      command: 'claude',
      args: ['--model', 'claude-sonnet-5-5'],
    });
  });
});
