import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BUILTIN_COLOR_THEMES, type ColorTheme } from '@overdeck/contracts';
import { ColorThemeEditorPreview } from '../sections/ColorThemeEditorPreview';
import { ensureSyntaxTheme, highlight } from '../../../lib/syntaxTheme';

vi.mock('../../../lib/syntaxTheme');

function theme(overrides: Partial<ColorTheme> & { type: 'light' | 'dark' }): ColorTheme {
  return { id: 'theme', builtin: false, name: 'Theme', ...overrides };
}

describe('ColorThemeEditorPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(ensureSyntaxTheme).mockResolvedValue('mock-theme');
    vi.mocked(highlight).mockResolvedValue('<pre><code>highlighted</code></pre>');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the terminal sample background and the red ANSI span from the theme palette', () => {
    const t = theme({ type: 'dark', terminal: { ...BUILTIN_COLOR_THEMES['overdeck-dark'].terminal, background: '#000000' } });
    render(<ColorThemeEditorPreview theme={t} />);

    const terminalEl = screen.getByTestId('color-theme-preview-terminal');
    expect(terminalEl).toHaveStyle({ backgroundColor: '#000000' });

    const redSpan = screen.getByTestId('color-theme-preview-ansi-red');
    const expectedRed = BUILTIN_COLOR_THEMES['overdeck-dark'].terminal!.red;
    expect(redSpan.style.color).not.toBe('');
    expect(redSpan).toHaveStyle({ color: expectedRed });
  });

  it('sets --background on the ui preview from ui.background, leaving <html> untouched', () => {
    const t = theme({ type: 'dark', ui: { background: '#123456' } });
    render(<ColorThemeEditorPreview theme={t} />);

    const uiEl = screen.getByTestId('color-theme-preview-ui');
    expect(uiEl.style.getPropertyValue('--background')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
  });

  it('re-highlights the code sample only 150ms after a syntax change, not before', async () => {
    const base = theme({ type: 'dark' });
    const changed = theme({
      type: 'dark',
      syntax: { tokenColors: [{ scope: 'comment', settings: { foreground: '#ff0000' } }] },
    });

    const { rerender } = render(<ColorThemeEditorPreview theme={base} />);
    await vi.advanceTimersByTimeAsync(150);
    vi.clearAllMocks();
    vi.mocked(ensureSyntaxTheme).mockResolvedValue('mock-theme-2');
    vi.mocked(highlight).mockResolvedValue('<pre><code>highlighted-2</code></pre>');

    rerender(<ColorThemeEditorPreview theme={changed} />);
    expect(highlight).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(highlight).toHaveBeenCalled();
  });
});
