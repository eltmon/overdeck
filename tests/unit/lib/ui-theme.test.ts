import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getUiTheme, getUiThemeSync, setUiTheme, colorFgBgForTheme, TERMINAL_BG } from '../../../src/lib/ui-theme.js';

describe('ui-theme', () => {
  let tempHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-ui-theme-'));
    prevHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('defaults to dark when no theme has been synced', async () => {
    expect(await getUiTheme()).toBe('dark');
  });

  it('round-trips light and dark', async () => {
    await setUiTheme('light');
    expect(await getUiTheme()).toBe('light');
    await setUiTheme('dark');
    expect(await getUiTheme()).toBe('dark');
  });

  it('falls back to dark on a corrupt file', async () => {
    await setUiTheme('light');
    const { writeFile } = await import('fs/promises');
    await writeFile(join(tempHome, 'ui-theme.json'), 'not json', 'utf-8');
    expect(await getUiTheme()).toBe('dark');
  });

  it('sync read matches async read', async () => {
    expect(getUiThemeSync()).toBe('dark');
    await setUiTheme('light');
    expect(getUiThemeSync()).toBe('light');
  });

  it('maps themes to COLORFGBG values Claude Code recognizes', () => {
    expect(colorFgBgForTheme('light')).toBe('0;15');
    expect(colorFgBgForTheme('dark')).toBe('15;0');
  });

  it('exposes pane backgrounds matching the frontend XTERM_BG values', () => {
    expect(TERMINAL_BG.dark).toBe('#1a1a2e');
    expect(TERMINAL_BG.light).toBe('#ffffff');
  });
});
