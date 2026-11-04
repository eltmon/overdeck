import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

function setMode(mode: 'light' | 'dark'): void {
  writeFileSync(join(testHome, 'ui-theme.json'), JSON.stringify({ theme: mode }), 'utf8');
}

describe('resolveTerminalBackground', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'pan-terminal-background-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns the selected dark theme terminal background', async () => {
    setMode('dark');
    const themesDir = join(testHome, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(
      join(themesDir, 'ayu-dark.json'),
      JSON.stringify({ name: 'Ayu Dark', type: 'dark', terminal: { background: '#0d1017' } }),
      'utf8',
    );
    writeFileSync(join(testHome, 'config.yaml'), 'ui:\n  color_theme:\n    dark: ayu-dark\n', 'utf8');

    const { resolveTerminalBackground } = await import('../terminal-background.js');
    expect(await resolveTerminalBackground()).toBe('#0d1017');
  });

  it('returns the built-in background for each mode when no selection is set', async () => {
    const { resolveTerminalBackground } = await import('../terminal-background.js');

    setMode('dark');
    expect(await resolveTerminalBackground()).toBe('#1a1a2e');

    setMode('light');
    expect(await resolveTerminalBackground()).toBe('#ffffff');
  });

  it('falls back to the built-in dark background when the selected theme has no terminal.background', async () => {
    setMode('dark');
    const themesDir = join(testHome, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, 'no-terminal.json'), JSON.stringify({ name: 'No Terminal', type: 'dark' }), 'utf8');
    writeFileSync(join(testHome, 'config.yaml'), 'ui:\n  color_theme:\n    dark: no-terminal\n', 'utf8');

    const { resolveTerminalBackground } = await import('../terminal-background.js');
    expect(await resolveTerminalBackground()).toBe('#1a1a2e');
  });
});
