import { describe, expect, it } from 'vitest';
import { ColorThemeImportError } from '../vscode-import.js';
import { importVsixThemes, MAX_VSIX_BYTES } from '../vsix-import.js';
import { buildVsix, buildZip } from './zip-fixture.js';

type ThemeEntry = { label?: string; uiTheme?: string; path?: string };

function manifest(themes: ThemeEntry[]): string {
  return JSON.stringify({ name: 'pack', contributes: { themes } });
}

function themeFile(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

async function importError(archive: Buffer, name = 'pack.vsix'): Promise<ColorThemeImportError> {
  try {
    await importVsixThemes(archive, name);
  } catch (err) {
    expect(err).toBeInstanceOf(ColorThemeImportError);
    return err as ColorThemeImportError;
  }
  throw new Error('importVsixThemes did not throw');
}

const LIGHT = themeFile({ colors: { 'editor.background': '#fafafa' }, tokenColors: [] });
const DARK = themeFile({ colors: { 'editor.background': '#1e1e1e' }, tokenColors: [] });

describe('importVsixThemes', () => {
  it('maps a light and a dark theme from uiTheme, with names from label', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: 'Two Light', uiTheme: 'vs', path: './themes/light.json' },
        { label: 'Two Dark', uiTheme: 'vs-dark', path: './themes/dark.json' },
      ]),
      'extension/themes/light.json': LIGHT,
      'extension/themes/dark.json': DARK,
    });

    const { themes, warnings } = await importVsixThemes(archive, 'two.vsix');

    expect(themes.map((t) => [t.name, t.type])).toEqual([['Two Light', 'light'], ['Two Dark', 'dark']]);
    expect(themes[0]!.source?.fileName).toBe('two.vsix:themes/light.json');
    expect(themes[1]!.source?.fileName).toBe('two.vsix:themes/dark.json');
    expect(warnings).toEqual([]);
  });

  it('maps hc-light and hc-black, and falls back to the file type with a warning when uiTheme is missing', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: 'HC Light', uiTheme: 'hc-light', path: './hcl.json' },
        { label: 'HC Black', uiTheme: 'hc-black', path: './hcb.json' },
        { label: 'No UI Theme', path: './plain.json' },
      ]),
      'extension/hcl.json': DARK,
      'extension/hcb.json': LIGHT,
      'extension/plain.json': themeFile({ type: 'light', colors: { 'editor.background': '#000000' } }),
    });

    const { themes, warnings } = await importVsixThemes(archive, 'hc.vsix');

    expect(themes.map((t) => t.type)).toEqual(['light', 'dark', 'light']);
    expect(warnings).toEqual([expect.stringMatching(/^"No UI Theme": .*uiTheme/)]);
  });

  it('merges an included file underneath: base colors fill gaps and base token rules come first', async () => {
    const ruleA = { scope: 'comment', settings: { foreground: '#aaaaaa' } };
    const ruleB = { scope: 'string', settings: { foreground: '#bbbbbb' } };
    const archive = buildVsix({
      'extension/package.json': manifest([{ label: 'Merged', uiTheme: 'vs-dark', path: './themes/dark.json' }]),
      'extension/themes/base.json': themeFile({
        colors: { 'editor.background': '#111111', 'terminal.ansiRed': '#ff0000' },
        tokenColors: [ruleA],
      }),
      'extension/themes/dark.json': themeFile({
        include: './base.json',
        colors: { 'editor.background': '#222222' },
        tokenColors: [ruleB],
      }),
    });

    const { themes } = await importVsixThemes(archive, 'merge.vsix');

    expect(themes[0]!.ui?.background).toBe('#222222');
    expect(themes[0]!.terminal?.red).toBe('#ff0000');
    expect(themes[0]!.syntax?.tokenColors).toEqual([ruleA, ruleB]);
  });

  it('follows an include into a sibling folder and drops a theme whose include leaves extension/', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: 'Shared', uiTheme: 'vs-dark', path: './themes/shared.json' },
        { label: 'Escapes', uiTheme: 'vs-dark', path: './themes/escapes.json' },
      ]),
      'extension/shared/base.json': themeFile({ colors: { 'terminal.ansiRed': '#ff1111' } }),
      'extension/themes/shared.json': themeFile({ include: '../shared/base.json', colors: {} }),
      'extension/themes/escapes.json': themeFile({ include: '../../outside.json', colors: {} }),
    });

    const { themes, warnings } = await importVsixThemes(archive, 'inc.vsix');

    expect(themes.map((t) => t.name)).toEqual(['Shared']);
    expect(themes[0]!.terminal?.red).toBe('#ff1111');
    expect(warnings).toEqual([expect.stringMatching(/^"Escapes": .*outside.*; skipped$/)]);
  });

  it('drops a theme with an include cycle and still imports the other theme', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: 'Cycle', uiTheme: 'vs-dark', path: './themes/a.json' },
        { label: 'Fine', uiTheme: 'vs', path: './themes/fine.json' },
      ]),
      'extension/themes/a.json': themeFile({ include: './b.json' }),
      'extension/themes/b.json': themeFile({ include: './a.json' }),
      'extension/themes/fine.json': LIGHT,
    });

    const { themes, warnings } = await importVsixThemes(archive, 'cycle.vsix');

    expect(themes.map((t) => t.name)).toEqual(['Fine']);
    expect(warnings).toEqual(['"Cycle": include cycle: themes/a.json → themes/b.json → themes/a.json; skipped']);
  });

  function includeChain(includes: number): Record<string, string> {
    const files: Record<string, string> = {
      'extension/package.json': manifest([
        { label: 'Deep', uiTheme: 'vs-dark', path: './t0.json' },
        { label: 'Other', uiTheme: 'vs', path: './other.json' },
      ]),
      'extension/other.json': LIGHT,
    };
    for (let i = 0; i <= includes; i += 1) {
      files[`extension/t${i}.json`] = themeFile(i < includes ? { include: `./t${i + 1}.json` } : { colors: { 'terminal.ansiRed': '#ff0000' } });
    }
    return files;
  }

  it('loads a chain of 5 includes and refuses a chain of 6', async () => {
    const five = await importVsixThemes(buildVsix(includeChain(5)), 'five.vsix');
    expect(five.themes.map((t) => t.name)).toEqual(['Deep', 'Other']);
    expect(five.themes[0]!.terminal?.red).toBe('#ff0000');

    const six = await importVsixThemes(buildVsix(includeChain(6)), 'six.vsix');
    expect(six.themes.map((t) => t.name)).toEqual(['Other']);
    expect(six.warnings).toEqual([expect.stringMatching(/^"Deep": include depth exceeds 5; skipped$/)]);
  });

  it('imports a theme whose tokenColors is a .tmTheme path, with a warning', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([{ label: 'TM', uiTheme: 'vs-dark', path: './tm.json' }]),
      'extension/tm.json': themeFile({ colors: { 'editor.background': '#000000' }, tokenColors: './x.tmTheme' }),
    });

    const { themes, warnings } = await importVsixThemes(archive, 'tm.vsix');

    expect(themes).toHaveLength(1);
    expect(warnings).toEqual([expect.stringMatching(/^"TM": .*\.tmTheme/)]);
  });

  it('drops a theme contributed as a .tmTheme file', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: 'Plist', uiTheme: 'vs-dark', path: './themes/old.tmTheme' },
        { label: 'Json', uiTheme: 'vs-dark', path: './themes/new.json' },
      ]),
      'extension/themes/old.tmTheme': '<plist/>',
      'extension/themes/new.json': DARK,
    });

    const { themes, warnings } = await importVsixThemes(archive, 'plist.vsix');

    expect(themes.map((t) => t.name)).toEqual(['Json']);
    expect(warnings).toEqual([expect.stringMatching(/^"Plist": .*\.tmTheme.*; skipped$/)]);
  });

  it('resolves NLS placeholder labels in both string and { message } forms', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: '%dark.label%', uiTheme: 'vs-dark', path: './dark.json' },
        { label: '%light.label%', uiTheme: 'vs', path: './light.json' },
      ]),
      'extension/package.nls.json': JSON.stringify({ 'dark.label': 'Night', 'light.label': { message: 'Day' } }),
      'extension/dark.json': DARK,
      'extension/light.json': LIGHT,
    });

    const { themes } = await importVsixThemes(archive, 'nls.vsix');

    expect(themes.map((t) => t.name)).toEqual(['Night', 'Day']);
  });

  it('names a theme from its file name, then its base name, when there is no label', async () => {
    const archive = buildVsix({
      'extension/package.json': manifest([
        { uiTheme: 'vs-dark', path: './named.json' },
        { uiTheme: 'vs-dark', path: './themes/Base Name.jsonc' },
      ]),
      'extension/named.json': themeFile({ name: 'From File', colors: {} }),
      'extension/themes/Base Name.jsonc': themeFile({ colors: {} }),
    });

    const { themes } = await importVsixThemes(archive, 'names.vsix');

    expect(themes.map((t) => t.name)).toEqual(['From File', 'Base Name']);
  });

  it('drops a theme file larger than 2 MiB and imports the other theme', async () => {
    const big = themeFile({ colors: {}, pad: 'a'.repeat(3 * 1024 * 1024) });
    const archive = buildVsix({
      'extension/package.json': manifest([
        { label: 'Big', uiTheme: 'vs-dark', path: './big.json' },
        { label: 'Small', uiTheme: 'vs-dark', path: './small.json' },
      ]),
      'extension/big.json': big,
      'extension/small.json': DARK,
    });

    const { themes, warnings } = await importVsixThemes(archive, 'big.vsix');

    expect(themes.map((t) => t.name)).toEqual(['Small']);
    expect(warnings).toEqual([expect.stringMatching(/^"Big": .*limit.*; skipped$/)]);
  });

  describe('package-level refusals', () => {
    it('refuses an archive over 10 MB', async () => {
      expect((await importError(Buffer.alloc(MAX_VSIX_BYTES + 1))).message).toContain('10 MB');
    });

    it('refuses a ZIP64 archive', async () => {
      const archive = buildVsix({ 'extension/package.json': manifest([{ uiTheme: 'vs', path: './a.json' }]) }, { zip64: true });
      expect((await importError(archive)).message).toContain('ZIP64');
    });

    it('refuses an archive with a .. entry path', async () => {
      const archive = buildVsix({
        'extension/package.json': manifest([{ uiTheme: 'vs', path: './a.json' }]),
        'extension/a.json': LIGHT,
        'extension/../evil.json': '{}',
      });
      expect((await importError(archive)).message).toContain('unsafe entry path');
    });

    it('refuses an archive without extension/package.json', async () => {
      const archive = buildZip([{ name: 'readme.md', data: 'hi' }]);
      expect((await importError(archive)).message).toContain('extension/package.json not found');
    });

    it('refuses a package with no contributed themes', async () => {
      const archive = buildVsix({ 'extension/package.json': manifest([]) });
      expect((await importError(archive)).message).toContain('contributes no color themes');
    });

    it('refuses more than 20 contributed themes', async () => {
      const themes = Array.from({ length: 21 }, (_, i) => ({ uiTheme: 'vs', path: `./t${i}.json` }));
      const archive = buildVsix({ 'extension/package.json': manifest(themes) });
      expect((await importError(archive)).message).toContain('at most 20');
    });

    it('refuses a package whose every theme is invalid', async () => {
      const archive = buildVsix({
        'extension/package.json': manifest([{ label: 'Gone', uiTheme: 'vs', path: './missing.json' }]),
      });
      const error = await importError(archive, 'bad.vsix');
      expect(error.message).toContain('no importable themes');
      expect(error.message).toContain('"missing.json" not found in the package');
    });
  });
});
