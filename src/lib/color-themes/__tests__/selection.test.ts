import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

function configPath(): string {
  return join(testHome, 'config.yaml');
}

describe('color theme selection', () => {
  beforeEach(() => {
    vi.resetModules();
    testHome = mkdtempSync(join(tmpdir(), 'pan-color-theme-selection-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('falls back to overdeck-dark when the dark id names no file, and warns exactly once across two calls', async () => {
    writeFileSync(configPath(), 'ui:\n  color_theme:\n    dark: missing-theme\n', 'utf8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveColorThemeSelection } = await import('../selection.js');

    const first = await resolveColorThemeSelection();
    const second = await resolveColorThemeSelection();

    expect(first.dark.id).toBe('overdeck-dark');
    expect(second.dark.id).toBe('overdeck-dark');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('ui.color_theme.dark');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('missing-theme');
    warnSpy.mockRestore();
  });

  it('falls back to overdeck-dark when the dark slot names a light-type theme, and warns that it is light', async () => {
    const themesDir = join(testHome, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, 'ayu-light.json'), JSON.stringify({ name: 'Ayu Light', type: 'light' }), 'utf8');
    writeFileSync(configPath(), 'ui:\n  color_theme:\n    dark: ayu-light\n', 'utf8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveColorThemeSelection } = await import('../selection.js');

    const { dark } = await resolveColorThemeSelection();

    expect(dark.id).toBe('overdeck-dark');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('light theme');
    warnSpy.mockRestore();
  });

  it('uses the built-in silently when no selection is set', async () => {
    const { resolveColorThemeSelection } = await import('../selection.js');
    const { light, dark } = await resolveColorThemeSelection();
    expect(light.id).toBe('overdeck-light');
    expect(dark.id).toBe('overdeck-dark');
  });

  it('saveColorThemeSelection persists the id and preserves a comment and an unrelated key byte-for-byte', async () => {
    writeFileSync(configPath(), '# keep me\nunrelated_key: keep-this-value\n', 'utf8');
    const { saveColorThemeSelection } = await import('../selection-write.js');

    await saveColorThemeSelection('dark', 'ayu-dark');

    const written = readFileSync(configPath(), 'utf8');
    expect(written).toContain('# keep me');
    expect(written).toContain('unrelated_key: keep-this-value');
    expect(written).toContain('color_theme');
    expect(written).toContain('dark: ayu-dark');
  });

  it('saveColorThemeSelection does not throw when ui.color_theme is a null scalar (e.g. "ui:\\n  color_theme:\\n")', async () => {
    writeFileSync(configPath(), 'ui:\n  color_theme:\n', 'utf8');
    const { saveColorThemeSelection } = await import('../selection-write.js');

    await saveColorThemeSelection('dark', 'ayu-dark');

    const written = readFileSync(configPath(), 'utf8');
    expect(written).toContain('dark: ayu-dark');
  });

  it('saveColorThemeSelection does not throw when ui itself is a null scalar (e.g. "ui:\\n")', async () => {
    writeFileSync(configPath(), 'ui:\n', 'utf8');
    const { saveColorThemeSelection } = await import('../selection-write.js');

    await saveColorThemeSelection('dark', 'ayu-dark');

    const written = readFileSync(configPath(), 'utf8');
    expect(written).toContain('dark: ayu-dark');
  });

  it('a fresh load after saveColorThemeSelection resolves the saved selection', async () => {
    const themesDir = join(testHome, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, 'ayu-dark.json'), JSON.stringify({ name: 'Ayu Dark', type: 'dark' }), 'utf8');
    writeFileSync(configPath(), '', 'utf8');
    const { saveColorThemeSelection } = await import('../selection-write.js');
    const { resolveColorThemeSelection } = await import('../selection.js');

    await saveColorThemeSelection('dark', 'ayu-dark');
    const { dark } = await resolveColorThemeSelection();

    expect(dark.id).toBe('ayu-dark');
  });
});
