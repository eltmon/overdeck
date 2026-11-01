import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

describe('color theme store', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'pan-color-themes-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('lists built-ins when the themes directory does not exist', async () => {
    const { listColorThemes } = await import('../store.js');
    const { themes, warnings } = await listColorThemes();
    expect(themes.map(t => t.id)).toEqual(['overdeck-dark', 'overdeck-light']);
    expect(warnings).toEqual([]);
  });

  it('returns a saved theme after the built-ins on a fresh list call (restart-equivalent)', async () => {
    const { listColorThemes, saveColorTheme } = await import('../store.js');
    const saved = await saveColorTheme({ name: 'Ayu Dark', type: 'dark' });
    if ('errors' in saved) throw new Error('expected a saved theme');
    expect(saved.theme.id).toBe('ayu-dark');

    const { themes } = await listColorThemes();
    expect(themes.map(t => t.id)).toEqual(['overdeck-dark', 'overdeck-light', 'ayu-dark']);
  });

  it('never overwrites: a second theme named "Ayu Dark" gets ayu-dark-2', async () => {
    const { saveColorTheme } = await import('../store.js');
    const first = await saveColorTheme({ name: 'Ayu Dark', type: 'dark' });
    const second = await saveColorTheme({ name: 'Ayu Dark', type: 'dark' });
    if ('errors' in first || 'errors' in second) throw new Error('expected saved themes');
    expect(first.theme.id).toBe('ayu-dark');
    expect(second.theme.id).toBe('ayu-dark-2');

    const onDisk = JSON.parse(readFileSync(join(testHome, 'themes', 'ayu-dark.json'), 'utf8'));
    expect(onDisk.name).toBe('Ayu Dark');
  });

  it('a preferredId of a reserved built-in id is never used as the file name', async () => {
    const { saveColorTheme } = await import('../store.js');
    const saved = await saveColorTheme({ name: 'Custom', type: 'dark' }, { preferredId: 'overdeck-dark' });
    if ('errors' in saved) throw new Error('expected a saved theme');
    expect(saved.theme.id).toBe('overdeck-dark-2');
  });

  it('skips a malformed JSON file and warns, naming it', async () => {
    const { listColorThemes } = await import('../store.js');
    const themesDir = join(testHome, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, 'broken.json'), '{ not valid json', 'utf8');

    const { themes, warnings } = await listColorThemes();
    expect(themes.map(t => t.id)).toEqual(['overdeck-dark', 'overdeck-light']);
    expect(warnings).toContainEqual(expect.stringContaining('broken.json'));
  });

  it('getColorTheme returns a built-in by id without touching disk', async () => {
    const { getColorTheme } = await import('../store.js');
    const theme = await getColorTheme('overdeck-light');
    expect(theme?.id).toBe('overdeck-light');
  });

  it('getColorTheme returns undefined for an id with no file', async () => {
    const { getColorTheme } = await import('../store.js');
    expect(await getColorTheme('does-not-exist')).toBeUndefined();
  });

  it('getColorTheme returns undefined for a prototype-shaped id (never resolves via the prototype chain)', async () => {
    const { getColorTheme } = await import('../store.js');
    expect(await getColorTheme('constructor')).toBeUndefined();
  });

  it('a 64-char base name collision gets a truncated, still-valid id (never exceeds 64 chars)', async () => {
    const { saveColorTheme } = await import('../store.js');
    const longName = 'a'.repeat(64);
    const first = await saveColorTheme({ name: longName, type: 'dark' });
    const second = await saveColorTheme({ name: longName, type: 'dark' });
    if ('errors' in first || 'errors' in second) throw new Error('expected saved themes');
    expect(first.theme.id).toHaveLength(64);
    expect(second.theme.id.length).toBeLessThanOrEqual(64);
    expect(second.theme.id).toMatch(/^a+-2$/);
    expect(second.theme.id).not.toBe(first.theme.id);
  });
});
