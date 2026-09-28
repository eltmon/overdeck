/**
 * PAN-4268: ensureMainInputTarget against a scripted fake pane built from the
 * Claude Code 2.1.280 fixtures. Each key moves the fake pane to the frame the
 * live probe showed; a key with no scripted transition leaves the screen as it
 * was. `sleep` is a no-op, so no test waits on a real timer.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectorKey } from '../../terminal-backends/agent-pane-io.js';
import { ensureMainInputTarget } from '../input-target.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

const FRAMES = {
  mainSelected: fixture('main-selected.txt'),
  footerMain: fixture('footer-focused-main.txt'),
  footerSubagent: fixture('footer-focused-subagent.txt'),
  subagentSelected: fixture('subagent-selected.txt'),
  // Footer focused, cursor on main, ● still on the subagent (the live probe's first Down).
  footerCursorMainFilledSubagent: fixture('footer-focused-subagent.txt')
    .replace('  ◯ main', '❯ ◯ main')
    .replace('❯ ● general-purpose', '  ● general-purpose'),
  noSubagents: fixture('no-subagents.txt'),
  garbled: fixture('garbled.txt'),
  fleetView: fixture('fleet-view.txt'),
  halfTyped: fixture('subagent-selected.txt').replace('❯ Message @general-purpose…', '❯ half typed'),
} as const;
type Frame = keyof typeof FRAMES;
type Script = Partial<Record<Frame | 'pill', Partial<Record<SelectorKey, Frame | 'pill'>>>>;

const everyKeySent: string[] = [];

function makeFakePane(start: Frame | 'pill', script: Script) {
  let frame: Frame | 'pill' = start;
  const keys: SelectorKey[] = [];
  return {
    keys,
    io: async () => ({
      read: async () => FRAMES[frame === 'pill' ? 'subagentSelected' : frame],
      sendKey: async (key: SelectorKey) => {
        keys.push(key);
        everyKeySent.push(key);
        frame = script[frame]?.[key] ?? frame;
      },
    }),
  };
}

const noSleep = async () => {};

const SWITCH_VIA_MAIN: Script = {
  subagentSelected: { Down: 'footerCursorMainFilledSubagent' },
  footerCursorMainFilledSubagent: { Enter: 'footerMain' },
  footerMain: { Escape: 'mainSelected' },
};

describe('ensureMainInputTarget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    expect(everyKeySent.length).toBeGreaterThan(0);
    for (const key of everyKeySent) expect(['Up', 'Down', 'Enter', 'Escape']).toContain(key);
  });

  it('main-selected: already main, zero keys', async () => {
    const pane = makeFakePane('mainSelected', {});
    await expect(ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep })).resolves.toEqual({ ok: true, check: 'already-main' });
    expect(pane.keys).toEqual([]);
  });

  it('no-subagents: no selector, zero keys', async () => {
    const pane = makeFakePane('noSubagents', {});
    await expect(ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep })).resolves.toEqual({ ok: true, check: 'no-selector' });
    expect(pane.keys).toEqual([]);
  });

  it('subagent-selected, first Down lands on main: Down, Enter, Escape', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pane = makeFakePane('subagentSelected', SWITCH_VIA_MAIN);
    await expect(ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep })).resolves.toEqual({
      ok: true,
      check: 'switched',
      switchedFromSubagent: 'Counter run',
    });
    expect(pane.keys).toEqual(['Down', 'Enter', 'Escape']);
    expect(log).toHaveBeenCalledWith('[input-target] conv-x: switched input from subagent "Counter run" to main');
  });

  it('subagent-selected, first Down lands on the subagent: Down, Up, Enter, Escape', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const pane = makeFakePane('subagentSelected', {
      subagentSelected: { Down: 'footerSubagent' },
      footerSubagent: { Up: 'footerCursorMainFilledSubagent' },
      footerCursorMainFilledSubagent: { Enter: 'footerMain' },
      footerMain: { Escape: 'mainSelected' },
    });
    await expect(ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep })).resolves.toEqual({
      ok: true,
      check: 'switched',
      switchedFromSubagent: 'Counter run',
    });
    expect(pane.keys).toEqual(['Down', 'Up', 'Enter', 'Escape']);
  });

  it('first Down only dismisses the shell pill: a second Down enters the footer', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const pane = makeFakePane('subagentSelected', {
      subagentSelected: { Down: 'pill' },
      pill: { Down: 'footerCursorMainFilledSubagent' },
      footerCursorMainFilledSubagent: { Enter: 'footerMain' },
      footerMain: { Escape: 'mainSelected' },
    });
    const result = await ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep });
    expect(result).toMatchObject({ ok: true, check: 'switched' });
    expect(pane.keys).toEqual(['Down', 'Down', 'Enter', 'Escape']);
  });

  it('fleet view that closes on Escape: only Escape, already main', async () => {
    const pane = makeFakePane('fleetView', { fleetView: { Escape: 'mainSelected' } });
    await expect(ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep })).resolves.toEqual({ ok: true, check: 'already-main' });
    expect(pane.keys).toEqual(['Escape']);
  });

  it('fleet view that persists: refused after one Escape', async () => {
    const pane = makeFakePane('fleetView', {});
    const result = await ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, inputTarget: 'unknown' });
    expect(result.ok === false && result.reason).toContain('agents overview');
    expect(pane.keys).toEqual(['Escape']);
  });

  it('footer focused on main: Escape only, already main', async () => {
    const pane = makeFakePane('footerMain', { footerMain: { Escape: 'mainSelected' } });
    await expect(ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep })).resolves.toEqual({ ok: true, check: 'already-main' });
    expect(pane.keys).toEqual(['Escape']);
  });

  it('Enter that leaves ● on the subagent is refused', async () => {
    const pane = makeFakePane('subagentSelected', { subagentSelected: { Down: 'footerCursorMainFilledSubagent' } });
    const result = await ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, inputTarget: { subagent: 'Counter run' } });
    expect(result.ok === false && result.reason).toContain('Enter');
    expect(pane.keys).toEqual(['Down', 'Enter']);
  });

  it('footer that never takes focus is refused after four Down presses', async () => {
    const pane = makeFakePane('subagentSelected', {});
    const result = await ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, reason: "Could not move keyboard focus into Claude Code's agent selector." });
    expect(pane.keys).toEqual(['Down', 'Down', 'Down', 'Down']);
  });

  it('garbled selector is refused as unknown with zero keys', async () => {
    const pane = makeFakePane('garbled', {});
    const result = await ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, inputTarget: 'unknown' });
    expect(pane.keys).toEqual([]);
  });

  it('a pane read that throws is refused', async () => {
    const sendKey = vi.fn(async () => {});
    const result = await ensureMainInputTarget('conv-x', {
      io: async () => ({ read: async () => { throw new Error('herdr holds no pane'); }, sendKey }),
      sleep: noSleep,
    });
    expect(result).toMatchObject({ ok: false, inputTarget: 'unknown' });
    expect(result.ok === false && result.reason.startsWith('Could not read')).toBe(true);
    expect(sendKey).not.toHaveBeenCalled();
  });

  it('pane resolution that throws is refused like a read failure', async () => {
    const result = await ensureMainInputTarget('conv-x', { io: async () => { throw new Error('socket down'); }, sleep: noSleep });
    expect(result.ok === false && result.reason.startsWith('Could not read')).toBe(true);
  });

  it('unsent prompt text while a subagent is filled is refused with zero keys', async () => {
    const pane = makeFakePane('halfTyped', {});
    const result = await ensureMainInputTarget('conv-x', { io: pane.io, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, inputTarget: { subagent: 'Counter run' } });
    expect(result.ok === false && result.reason).toContain('unsent text');
    expect(pane.keys).toEqual([]);
  });

  it('a key that fails to send is refused', async () => {
    const result = await ensureMainInputTarget('conv-x', {
      io: async () => ({ read: async () => FRAMES.subagentSelected, sendKey: async () => { throw new Error('pane gone'); } }),
      sleep: noSleep,
    });
    expect(result.ok === false && result.reason).toBe('Could not send a navigation key to conv-x: pane gone');
  });
});
