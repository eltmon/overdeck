import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ColorThemeImportError, mapVsCodeTheme } from '../vscode-import.js';
import { mapVsCodeThemeObject, parseVsCodeThemeText } from '../vscode-import.js';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

describe('mapVsCodeTheme', () => {
  it('maps the Ayu Dark fixture', () => {
    const { theme } = mapVsCodeTheme(fixture('ayu-dark.jsonc'), 'ayu-dark.jsonc');

    expect(theme.type).toBe('dark');
    expect(theme.terminal?.background).toBe('#0d1017');
    expect(theme.terminal?.red).toBe('#f06b73');
    expect(theme.terminal).toMatchObject({
      black: expect.any(String), red: expect.any(String), green: expect.any(String), yellow: expect.any(String),
      blue: expect.any(String), magenta: expect.any(String), cyan: expect.any(String), white: expect.any(String),
      brightBlack: expect.any(String), brightRed: expect.any(String), brightGreen: expect.any(String),
      brightYellow: expect.any(String), brightBlue: expect.any(String), brightMagenta: expect.any(String),
      brightCyan: expect.any(String), brightWhite: expect.any(String),
    });
    expect(theme.syntax?.tokenColors).toHaveLength(66);
    expect(theme.ui?.foreground).toBe('#bfbdb6');
    expect(theme.ui?.accent).toBe('#e6b450');
  });

  it('maps editorWidget.background to ui.overlay when quickInput.background is absent', () => {
    const { theme } = mapVsCodeTheme(fixture('ayu-dark.jsonc'), 'ayu-dark.jsonc');
    expect(theme.ui?.overlay).toBe('#141821');
  });

  it('prefers quickInput.background over editorWidget.background', () => {
    const { theme } = mapVsCodeTheme(
      JSON.stringify({ type: 'dark', colors: { 'quickInput.background': '#202020', 'editorWidget.background': '#303030' } }),
      'inline.json',
    );
    expect(theme.ui?.overlay).toBe('#202020');
  });

  it('drops the alpha channel from the overlay color', () => {
    const { theme } = mapVsCodeTheme(
      JSON.stringify({ type: 'dark', colors: { 'quickInput.background': '#20242ccc' } }),
      'inline.json',
    );
    expect(theme.ui?.overlay).toBe('#20242c');
  });

  it('leaves ui.overlay unset when neither key exists', () => {
    const { theme } = mapVsCodeTheme(
      JSON.stringify({ type: 'dark', colors: { 'editor.background': '#000000' } }),
      'inline.json',
    );
    expect(theme.ui?.overlay).toBeUndefined();
  });

  it('maps the Ayu Light fixture to type light', () => {
    const { theme } = mapVsCodeTheme(fixture('ayu-light.jsonc'), 'ayu-light.jsonc');
    expect(theme.type).toBe('light');
  });

  it('maps the no-terminal fixture with no terminal group and its two tokenColors, without throwing', () => {
    const { theme, warnings } = mapVsCodeTheme(fixture('no-terminal.jsonc'), 'no-terminal.jsonc');
    expect(theme.terminal).toBeUndefined();
    expect(theme.syntax?.tokenColors).toHaveLength(2);
    expect(theme.type).toBe('dark');
    expect(warnings.some(w => w.includes('include'))).toBe(false);
  });

  it('rejects invalid JSON with the offset of the first error', () => {
    let caught: unknown;
    try {
      mapVsCodeTheme('{ "name": "Broken", "type": }', 'broken.json');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ColorThemeImportError);
    expect((caught as Error).message).toMatch(/offset \d+/);
  });

  it('warns when include is present', () => {
    const text = JSON.stringify({ name: 'Partial', type: 'dark', include: './base.json' });
    const { warnings } = mapVsCodeTheme(text, 'partial.json');
    expect(warnings).toContainEqual(expect.stringContaining('include'));
  });

  it('warns and drops syntax when tokenColors is a path string', () => {
    const text = JSON.stringify({ name: 'PathTokens', type: 'dark', tokenColors: './tokens.json' });
    const { theme, warnings } = mapVsCodeTheme(text, 'path-tokens.json');
    expect(theme.syntax).toBeUndefined();
    expect(warnings).toContainEqual(expect.stringContaining('tokenColors'));
  });

  it('guesses dark/light from editor.background luminance when type is absent', () => {
    const darkText = JSON.stringify({ name: 'Guessed Dark', colors: { 'editor.background': '#101010' } });
    const lightText = JSON.stringify({ name: 'Guessed Light', colors: { 'editor.background': '#f0f0f0' } });
    expect(mapVsCodeTheme(darkText, 'd.json').theme.type).toBe('dark');
    expect(mapVsCodeTheme(lightText, 'l.json').theme.type).toBe('light');
  });

  it('guesses dark/light from a shorthand 3-digit editor.background hex', () => {
    const darkText = JSON.stringify({ name: 'Guessed Dark Short', colors: { 'editor.background': '#111' } });
    const lightText = JSON.stringify({ name: 'Guessed Light Short', colors: { 'editor.background': '#fff' } });
    expect(mapVsCodeTheme(darkText, 'd.json').theme.type).toBe('dark');
    expect(mapVsCodeTheme(lightText, 'l.json').theme.type).toBe('light');
  });

  it('falls back to the file name when name is absent', () => {
    const { theme } = mapVsCodeTheme(JSON.stringify({ type: 'dark' }), 'My Theme.json');
    expect(theme.name).toBe('My Theme');
  });

  it('strips a leading UTF-8 BOM before parsing', () => {
    const { theme } = mapVsCodeTheme('\uFEFF{"name":"B","type":"dark"}', 'b.json');
    expect(theme.name).toBe('B');
  });
});

describe('mapVsCodeThemeObject', () => {
  it('maps an already-parsed object without include or tokenColors warnings', () => {
    const { theme, warnings } = mapVsCodeThemeObject(
      { name: 'X', type: 'light', colors: { 'editor.background': '#ffffff' }, tokenColors: [] },
      'x.json',
    );
    expect(theme.type).toBe('light');
    expect(warnings.filter((w) => w.includes('include') || w.includes('tokenColors'))).toEqual([]);
  });
});

describe('parseVsCodeThemeText', () => {
  it('returns the parsed object and rejects non-object JSON', () => {
    expect(parseVsCodeThemeText('{"name":"P", /* c */ }')).toEqual({ name: 'P' });
    expect(() => parseVsCodeThemeText('[1]')).toThrow(ColorThemeImportError);
  });
});
