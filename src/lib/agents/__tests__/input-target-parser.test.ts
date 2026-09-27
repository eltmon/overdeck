/**
 * PAN-4268: parser tests against Claude Code 2.1.280 pane captures.
 *
 * main-selected, footer-focused-main, footer-focused-subagent,
 * subagent-selected and fleet-view are verbatim probe captures.
 * several-subagents is synthesized from the issue's grouped-row capture
 * (conversation 2942); no-subagents, garbled and transcript-bullets-only are
 * edits of the probe captures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inputTargetFromSelector, parseAgentSelector } from '../input-target.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

function parse(name: string) {
  const state = parseAgentSelector(fixture(name));
  return { state, target: inputTargetFromSelector(state) };
}

describe('parseAgentSelector / inputTargetFromSelector', () => {
  it('no-subagents: no rows, input goes to main', () => {
    const { state, target } = parse('no-subagents.txt');
    expect(state.rows).toEqual([]);
    expect(target).toBe('main');
  });

  it('transcript-bullets-only: ● lines above the prompt box are not selector rows', () => {
    const { state, target } = parse('transcript-bullets-only.txt');
    expect(state.rows).toEqual([]);
    expect(target).toBe('main');
  });

  it('main-selected: two rows, main filled, prompt focused', () => {
    const { state, target } = parse('main-selected.txt');
    expect(state.rows).toHaveLength(2);
    expect(state.mainIndex).toBe(0);
    expect(state.filledIndex).toBe(0);
    expect(state.cursorIndex).toBeNull();
    expect(state.footerHint).toBe(false);
    expect(state.fleetView).toBe(false);
    expect(state.promptText).toBe('');
    expect(state.rows[1]).toMatchObject({ agentType: 'general-purpose', description: 'Counter run', groupCount: 0, filled: false });
    expect(target).toBe('main');
  });

  it('footer-focused-main: cursor on main with the footer hint', () => {
    const { state, target } = parse('footer-focused-main.txt');
    expect(state.cursorIndex).toBe(0);
    expect(state.footerHint).toBe(true);
    expect(target).toBe('main');
  });

  it('subagent-selected: the subagent is filled and its placeholder counts as an empty prompt', () => {
    const { state, target } = parse('subagent-selected.txt');
    expect(state.filledIndex).toBe(1);
    expect(state.cursorIndex).toBeNull();
    expect(state.promptText).toBe('');
    expect(target).toEqual({ subagent: 'Counter run' });
  });

  it('footer-focused-subagent: cursor and filled dot on the subagent', () => {
    const { state, target } = parse('footer-focused-subagent.txt');
    expect(state.cursorIndex).toBe(1);
    expect(state.filledIndex).toBe(1);
    expect(state.footerHint).toBe(true);
    expect(target).toEqual({ subagent: 'Counter run' });
  });

  it('several-subagents: grouped row parsed and the filled subagent wins', () => {
    const { state, target } = parse('several-subagents.txt');
    expect(state.rows).toHaveLength(4);
    expect(state.rows[1]).toMatchObject({
      agentType: 'general-purpose',
      groupCount: 3,
      description: 'Scanning handleConversationCreate for cwd defaults',
    });
    expect(target).toEqual({ subagent: 'Map the delivery door' });
  });

  it('garbled: rows without a main row are unknown', () => {
    const { state, target } = parse('garbled.txt');
    expect(state.rows.length).toBeGreaterThan(0);
    expect(state.mainIndex).toBeNull();
    expect(target).toBe('unknown');
  });

  it('fleet-view: Claude Code agents overview is unknown', () => {
    const { state, target } = parse('fleet-view.txt');
    expect(state.fleetView).toBe(true);
    expect(target).toBe('unknown');
  });

  it('two filled rows are unknown', () => {
    const screen = fixture('main-selected.txt').replace('  ◯ general-purpose', '  ● general-purpose');
    const state = parseAgentSelector(screen);
    expect(state.filledCount).toBe(2);
    expect(state.filledIndex).toBeNull();
    expect(inputTargetFromSelector(state)).toBe('unknown');
  });

  it('⏺ main (macOS glyph) counts as filled', () => {
    const screen = fixture('main-selected.txt').replace('  ● main', '  ⏺ main');
    const state = parseAgentSelector(screen);
    expect(state.rows[0].filled).toBe(true);
    expect(inputTargetFromSelector(state)).toBe('main');
  });

  it('strips ANSI escapes and keeps unsent prompt text', () => {
    const screen = fixture('subagent-selected.txt')
      .replace('❯ Message @general-purpose…', '❯ half typed')
      .replace('  ● general-purpose', '\x1b[1m  ● general-purpose\x1b[0m');
    const state = parseAgentSelector(screen);
    expect(state.promptText).toBe('half typed');
    expect(inputTargetFromSelector(state)).toEqual({ subagent: 'Counter run' });
  });
});
