import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ColorTheme } from '@overdeck/contracts';

const registerCustomThemeMock = vi.hoisted(() => vi.fn());
const getSharedHighlighterMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  codeToHtml: (code: string, options: { theme: string }) => `<pre data-theme="${options.theme}"><code>${code}</code></pre>`,
}));

vi.mock('@pierre/diffs', () => ({
  registerCustomTheme: registerCustomThemeMock,
  getSharedHighlighter: getSharedHighlighterMock,
}));

const { ensureSyntaxTheme, highlight, syntaxThemeName } = await import('../syntaxTheme');

function theme(overrides: Partial<ColorTheme> & { id: string; type: 'light' | 'dark' }): ColorTheme {
  return { builtin: false, name: overrides.id, ...overrides };
}

describe('syntaxThemeName', () => {
  it('ac2: returns github-light for a light theme with no syntax group', () => {
    expect(syntaxThemeName(theme({ id: 'overdeck-light', type: 'light' }))).toBe('github-light');
  });

  it('PAN-4906: returns github-dark for a dark theme with no syntax group', () => {
    expect(syntaxThemeName(theme({ id: 'overdeck-dark', type: 'dark' }))).toBe('github-dark');
  });

  it('returns a name starting overdeck-<id>- for a theme with a syntax group', () => {
    const name = syntaxThemeName(theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [] } }));
    expect(name.startsWith('overdeck-ayu-dark-')).toBe(true);
  });

  it('ac3: a different syntax content produces a different name', () => {
    const a = syntaxThemeName(theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#111111' } }] } }));
    const b = syntaxThemeName(theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#222222' } }] } }));
    expect(a).not.toBe(b);
  });
});

describe('ensureSyntaxTheme', () => {
  beforeEach(() => {
    registerCustomThemeMock.mockClear();
  });

  it('ac1: registers exactly once across two calls for the same theme', async () => {
    const ayuDark = theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#111111' } }] } });

    const first = await ensureSyntaxTheme(ayuDark);
    const second = await ensureSyntaxTheme(ayuDark);

    expect(first).toBe(second);
    expect(first.startsWith('overdeck-ayu-dark-')).toBe(true);
    expect(registerCustomThemeMock).toHaveBeenCalledTimes(1);
    expect(registerCustomThemeMock.mock.calls[0]?.[0]).toBe(first);
  });

  it('ac2: never registers for a theme with no syntax group', async () => {
    const name = await ensureSyntaxTheme(theme({ id: 'overdeck-light', type: 'light' }));
    expect(name).toBe('github-light');
    expect(registerCustomThemeMock).not.toHaveBeenCalled();
  });

  it('ac3: a changed syntax produces a new registration', async () => {
    const before = theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#333333' } }] } });
    const after = theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#444444' } }] } });

    const nameBefore = await ensureSyntaxTheme(before);
    const nameAfter = await ensureSyntaxTheme(after);

    expect(nameBefore).not.toBe(nameAfter);
    expect(registerCustomThemeMock).toHaveBeenCalledTimes(2);
  });

  it('two concurrent calls for a new theme share one registration instead of racing it (PAN-4644 review)', async () => {
    const concurrent = theme({ id: 'concurrent-theme', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#666666' } }] } });

    const [first, second] = await Promise.all([ensureSyntaxTheme(concurrent), ensureSyntaxTheme(concurrent)]);

    expect(first).toBe(second);
    expect(registerCustomThemeMock).toHaveBeenCalledTimes(1);
  });

  it('a failed registration is never marked registered, so a later call retries it', async () => {
    const flaky = theme({ id: 'flaky', type: 'dark', syntax: { tokenColors: [{ settings: { foreground: '#555555' } }] } });
    registerCustomThemeMock.mockImplementationOnce(() => { throw new Error('registration failed'); });

    await expect(ensureSyntaxTheme(flaky)).rejects.toThrow('registration failed');
    expect(registerCustomThemeMock).toHaveBeenCalledTimes(1);

    const name = await ensureSyntaxTheme(flaky);
    expect(registerCustomThemeMock).toHaveBeenCalledTimes(2);
    expect(name.startsWith('overdeck-flaky-')).toBe(true);
  });
});

describe('highlight', () => {
  it('ac1: passes the registered theme name starting overdeck-ayu-dark- to getSharedHighlighter', async () => {
    const ayuDark = theme({ id: 'ayu-dark', type: 'dark', syntax: { tokenColors: [] } });
    const name = await ensureSyntaxTheme(ayuDark);

    await highlight('const x = 1;', 'ts', name);

    expect(getSharedHighlighterMock).toHaveBeenCalledWith({ themes: [name], langs: [] });
    expect(name.startsWith('overdeck-ayu-dark-')).toBe(true);
  });

  it('ac2: preserves the current highlight output for github-light', async () => {
    const html = await highlight('const x = 1;', 'ts', 'github-light');
    expect(html).toBe('<pre data-theme="github-light"><code>const x = 1;</code></pre>');
  });
});
