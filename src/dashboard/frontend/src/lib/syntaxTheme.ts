/**
 * Chat/quickview syntax highlighting with the active color theme's
 * `syntax` colors (PAN-4644). A theme without `syntax` keeps the
 * existing `github-light` look.
 */
import type { DiffsThemeNames } from '@pierre/diffs';
import type { ColorTheme } from '@overdeck/contracts';
import { fnv1a32 } from './diffRendering.js';

const FALLBACK_THEME_NAME = 'github-light';

/** `github-light` when the theme has no `syntax` group, else a name unique to that syntax content. */
export function syntaxThemeName(theme: ColorTheme): string {
  if (theme.syntax === undefined) return FALLBACK_THEME_NAME;
  return `overdeck-${theme.id}-${fnv1a32(JSON.stringify(theme.syntax)).toString(36)}`;
}

const registeredThemeNames = new Set<string>();

/** Registers the theme's syntax colors with @pierre/diffs's shared highlighter, once per name. */
export async function ensureSyntaxTheme(theme: ColorTheme): Promise<string> {
  const name = syntaxThemeName(theme);
  if (name === FALLBACK_THEME_NAME || registeredThemeNames.has(name)) return name;
  registeredThemeNames.add(name);

  const { registerCustomTheme } = await import('@pierre/diffs');
  const syntax = theme.syntax!;
  registerCustomTheme(name, async () => ({
    name,
    type: theme.type,
    colors: syntax.colors ?? {},
    tokenColors: syntax.tokenColors,
  }));
  return name;
}

/** Highlights `code` with the given (already-registered) theme name. */
export async function highlight(code: string, lang: string, themeName: string): Promise<string> {
  const { getSharedHighlighter } = await import('@pierre/diffs');
  const highlighter = await getSharedHighlighter({ themes: [themeName as DiffsThemeNames], langs: [] }) as {
    codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
  };
  return highlighter.codeToHtml(code, { lang: lang || 'text', theme: themeName });
}
