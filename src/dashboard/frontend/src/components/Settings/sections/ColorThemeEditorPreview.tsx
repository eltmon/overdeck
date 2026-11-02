import { useEffect, useState } from 'react';
import { effectiveTerminalPalette, type ColorTheme, type TerminalPalette } from '@overdeck/contracts';
import { uiTokenStyles } from '../../../lib/uiTokenStyles';
import { ensureSyntaxTheme, highlight } from '../../../lib/syntaxTheme';

const ANSI_KEYS: Array<keyof TerminalPalette> = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

// D9: the code sample re-highlights 150ms after the last theme change —
// registering a Shiki theme on every picker drag would be wasteful.
const CODE_PREVIEW_DEBOUNCE_MS = 150;

const SAMPLE = '// Greet a user\ntype Name = string;\nfunction greet(name: Name, times: number) {\n  const message = `Hello, ${name}`;\n  return message.repeat(times + 1);\n}';

function TerminalPreview({ theme }: { theme: ColorTheme }) {
  const palette = effectiveTerminalPalette(theme);
  return (
    <pre
      data-testid="color-theme-preview-terminal"
      className="rounded-md p-2 text-xs"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
    >
      {'$ overdeck status\n'}
      {ANSI_KEYS.map((key) => (
        <span key={key} data-testid={`color-theme-preview-ansi-${key}`} style={{ color: palette[key] }}>
          {key}{' '}
        </span>
      ))}
      {'\n'}
      <span data-testid="color-theme-preview-selection" style={{ backgroundColor: palette.selectionBackground }}>
        selected text
      </span>
      {' '}
      <span
        data-testid="color-theme-preview-cursor"
        style={{ backgroundColor: palette.cursor, color: palette.cursorAccent }}
      >
        {' '}
      </span>
    </pre>
  );
}

function UiPreview({ theme }: { theme: ColorTheme }) {
  return (
    <div
      data-testid="color-theme-preview-ui"
      className="rounded-md border border-border bg-background p-3 text-foreground"
      style={uiTokenStyles(theme) as React.CSSProperties}
    >
      <div className="rounded-md bg-card p-2">
        <div className="text-sm font-medium">Appearance</div>
        <div className="text-xs text-muted-foreground">Preview card surface</div>
      </div>
      <span className="mt-2 inline-block rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">Save</span>
      <div className="mt-2 rounded-md p-2 text-xs" style={{ background: 'var(--surface-overlay)' }}>
        Dialog
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Colors that are not set show the current dashboard defaults.
      </div>
    </div>
  );
}

function CodePreview({ theme }: { theme: ColorTheme }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void ensureSyntaxTheme(theme).then((name) => highlight(SAMPLE, 'ts', name)).then((result) => {
        if (!cancelled) setHtml(result);
      }).catch(() => { /* registration or highlighting failed; keep the plain-text fallback */ });
    }, CODE_PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [theme]);

  return (
    <div data-testid="color-theme-preview-code" className="mt-2 text-xs">
      {html !== null
        // eslint-disable-next-line react/no-danger
        ? <div dangerouslySetInnerHTML={{ __html: html }} />
        : <pre className="whitespace-pre-wrap">{SAMPLE}</pre>}
    </div>
  );
}

/** Live preview of a draft color theme (PAN-4660): a static terminal sample, a UI card, and a debounced syntax-highlighted code sample. */
export function ColorThemeEditorPreview({ theme }: { theme: ColorTheme }) {
  return (
    <div className="space-y-2" data-testid="color-theme-editor-preview">
      <TerminalPreview theme={theme} />
      <UiPreview theme={theme} />
      <CodePreview theme={theme} />
    </div>
  );
}
