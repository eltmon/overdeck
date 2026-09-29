import { describe, expect, it } from 'vitest';
import {
  CLAUDE_INJECTED_PREFIXES,
  CODEX_INJECTED_PREFIXES,
  countHumanTurns,
  isHumanTurn,
} from '../../../../src/lib/vault/turns.js';

function claudeUser(content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'user', uuid: 'u', message: { role: 'user', content }, ...extra });
}

function claudeAssistant(text: string): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

function codexUser(content: unknown): string {
  return JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content } });
}

describe('vault turns: Claude Code', () => {
  it('ac1: counts 3 typed prompts and ignores 4 injected user-role lines', () => {
    const lines = [
      claudeUser('fix the failing test'),
      claudeAssistant('Looking.'),
      claudeUser('<task-notification>\n<task-id>abc</task-id>\n</task-notification>'),
      claudeUser([{ type: 'text', text: '<command-name>/clear</command-name>' }]),
      claudeUser('<local-command-stdout>ok</local-command-stdout>'),
      claudeUser([{ type: 'tool_result', tool_use_id: 't1', content: 'output' }]),
      claudeUser([{ type: 'text', text: 'now add a test' }]),
      claudeAssistant('Done.'),
      claudeUser('[Request interrupted by user]'),
      claudeUser('summary of prior work', { isCompactSummary: true }),
      claudeUser('<local-command-caveat>Caveat: the messages below were generated</local-command-caveat>'),
      claudeUser('thanks, ship it'),
    ];
    expect(countHumanTurns(lines, 'claude-code')).toBe(3);
  });

  it('ac3: a typed prompt starting with <div> is a human turn', () => {
    expect(isHumanTurn(claudeUser('<div>hello</div> what does this render as?'), 'claude-code')).toBe(true);
    expect(isHumanTurn(claudeUser([{ type: 'text', text: '<div>x</div>' }]), 'claude-code')).toBe(true);
  });

  it('matches injected lines by exact prefix only', () => {
    for (const prefix of CLAUDE_INJECTED_PREFIXES) {
      expect(isHumanTurn(claudeUser(`${prefix} payload`), 'claude-code')).toBe(false);
    }
    expect(isHumanTurn(claudeUser('<task-notifications are cool'), 'claude-code')).toBe(true);
    expect(isHumanTurn(claudeUser('Request interrupted by user? no'), 'claude-code')).toBe(true);
  });

  it('ignores non-user entries, empty prompts and unparseable lines', () => {
    expect(isHumanTurn(claudeAssistant('hi'), 'claude-code')).toBe(false);
    expect(isHumanTurn(claudeUser('   '), 'claude-code')).toBe(false);
    expect(isHumanTurn(claudeUser([]), 'claude-code')).toBe(false);
    expect(isHumanTurn('{not json', 'claude-code')).toBe(false);
    expect(isHumanTurn(JSON.stringify({ type: 'summary', summary: 'x' }), 'claude-code')).toBe(false);
  });

  it('accepts already-parsed entries', () => {
    expect(isHumanTurn(JSON.parse(claudeUser('typed')), 'claude-code')).toBe(true);
  });
});

describe('vault turns: Codex', () => {
  it('ac2: counts 2 typed prompts and ignores an <environment_context> line', () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { id: 's' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: 'instructions' } }),
      codexUser([{ type: 'input_text', text: '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>' }]),
      codexUser([{ type: 'input_text', text: 'refactor the parser' }]),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'refactor the parser' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] } }),
      codexUser('add tests too'),
      JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'add tests too' }] } } }),
    ];
    expect(countHumanTurns(lines, 'codex')).toBe(2);
  });

  it('matches every Codex injected prefix exactly and keeps <div> prompts', () => {
    for (const prefix of CODEX_INJECTED_PREFIXES) {
      expect(isHumanTurn(codexUser(`${prefix}\nstuff`), 'codex')).toBe(false);
    }
    expect(isHumanTurn(codexUser('<div>why is this centered?</div>'), 'codex')).toBe(true);
    expect(isHumanTurn(codexUser('# Files mentioned: none'), 'codex')).toBe(true);
  });
});
