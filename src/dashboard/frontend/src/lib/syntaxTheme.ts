/**
 * Chat/quickview syntax highlighting with the active color theme's
 * `syntax` colors (PAN-4644). A theme without `syntax` falls back to
 * `github-light`, or `github-dark` for a dark theme: light-theme token colors
 * on a dark code block were nearly invisible (PAN-4906).
 */
import type { DiffsThemeNames } from '@pierre/diffs';
import type { ColorTheme } from '@overdeck/contracts';
import { fnv1a32 } from './diffRendering.js';

const FALLBACK_THEME_NAMES: Record<ColorTheme['type'], string> = { light: 'github-light', dark: 'github-dark' };

/** `github-light`/`github-dark` (by theme type) when the theme has no `syntax` group, else a name unique to that syntax content. */
export function syntaxThemeName(theme: ColorTheme): string {
  if (theme.syntax === undefined) return FALLBACK_THEME_NAMES[theme.type];
  return `overdeck-${theme.id}-${fnv1a32(JSON.stringify(theme.syntax)).toString(36)}`;
}

// Cache the in-flight registration promise per name (not just a "done" flag)
// so two concurrent callers for the same new theme share one registration
// instead of both racing `registerCustomTheme`, and a rejected import drops
// its entry so the next call retries instead of serving a dead promise
// (PAN-4644 review).
const registrations = new Map<string, Promise<string>>();

/** Registers the theme's syntax colors with @pierre/diffs's shared highlighter, once per name. */
export function ensureSyntaxTheme(theme: ColorTheme): Promise<string> {
  const name = syntaxThemeName(theme);
  if (theme.syntax === undefined) return Promise.resolve(name);

  let pending = registrations.get(name);
  if (pending === undefined) {
    const syntax = theme.syntax!;
    pending = import('@pierre/diffs').then(({ registerCustomTheme }) => {
      registerCustomTheme(name, async () => ({
        name,
        type: theme.type,
        colors: syntax.colors ?? {},
        tokenColors: syntax.tokenColors,
      }));
      return name;
    });
    pending.catch(() => registrations.delete(name));
    registrations.set(name, pending);
  }
  return pending;
}

/** Highlights `code` with the given (already-registered) theme name. */
export async function highlight(code: string, lang: string, themeName: string): Promise<string> {
  const { getSharedHighlighter } = await import('@pierre/diffs');
  const highlighter = await getSharedHighlighter({ themes: [themeName as DiffsThemeNames], langs: [] }) as {
    codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
  };
  return highlighter.codeToHtml(code, { lang: lang || 'text', theme: themeName });
}
