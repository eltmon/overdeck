import { afterEach, describe, expect, it, vi } from 'vitest';
import { paneShowsClaudeBootBlockingScreen } from '../../../../src/lib/cloister/modal-detector.js';

afterEach(() => vi.useRealTimers());


describe('Claude boot-blocking screen detector', () => {
  it('matches each first-run onboarding screen (conv-20260714-4261)', () => {
    expect(paneShowsClaudeBootBlockingScreen(
      "Let's get started.\n Choose the text style that looks best with your terminal\n ❯ 1. Auto (match terminal) ✔",
    )).toBe(true);
    expect(paneShowsClaudeBootBlockingScreen(
      ' Select login method:\n ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise',
    )).toBe(true);
    expect(paneShowsClaudeBootBlockingScreen('Do you trust the files in this folder?')).toBe(true);
    expect(paneShowsClaudeBootBlockingScreen('Paste code here if prompted > ')).toBe(true);
  });

  it('does not match a normal REPL welcome banner or ordinary output', () => {
    expect(paneShowsClaudeBootBlockingScreen('Welcome to Claude Code v2.1.209\n❯ ')).toBe(false);
    expect(paneShowsClaudeBootBlockingScreen('npm run build\n✓ built in 12s')).toBe(false);
    expect(paneShowsClaudeBootBlockingScreen('')).toBe(false);
  });
});
