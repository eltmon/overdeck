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

  it('passes known IDs through as their full API IDs', () => {
    expect(getClaudeModelFlag('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(getClaudeModelFlag('claude-fable-5-1')).toBe('claude-fable-5-1');
  });

  // Claude Code 2.1.293 resolves the short `haiku` alias to Haiku 5.5, and the
  // `opus` alias resolves to Opus 5.5, so neither alias may stand in for an
  // older configured ID.
  it.each(['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6'])(
    'maps %s to its own full API ID, never the haiku or opus alias',
    (model) => {
      expect(getClaudeModelFlag(model)).toBe(model);
    },
  );

  it('launches claude-haiku-4-5 as Haiku 4.5, not the haiku alias', () => {
    expect(getAgentCommand('claude-haiku-4-5')).toEqual({
      command: 'claude',
      args: ['--model', 'claude-haiku-4-5'],
    });
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
