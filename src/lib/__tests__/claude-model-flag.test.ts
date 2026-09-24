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
    expect(getClaudeModelFlag('claude-sonnet-5')).toBe('sonnet');
    expect(getClaudeModelFlag('claude-haiku-4-5')).toBe('haiku');
    expect(getClaudeModelFlag('claude-opus-5-5')).toBe('claude-opus-5-5');
  });
});
