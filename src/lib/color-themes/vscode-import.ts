/**
 * Maps a VS Code theme JSON(C) file to a color theme (PAN-4644). Never
 * fills fallback colors into the result — fallbacks apply at use time
 * (`effectiveTerminalPalette`), so a built-in palette change reaches
 * imported themes. The parse and map halves are split so the .vsix import
 * (PAN-4659, `vsix-import.ts`) can map an already-merged include chain.
 */
import { parse, type ParseError } from 'jsonc-parser';
import { normalizeColorTheme, toOpaqueHex, type ColorTheme, type ColorThemeType } from '@overdeck/contracts';

export class ColorThemeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColorThemeImportError';
  }
}

const TERMINAL_ANSI_KEYS = [
  ['terminal.ansiBlack', 'black'], ['terminal.ansiRed', 'red'], ['terminal.ansiGreen', 'green'],
  ['terminal.ansiYellow', 'yellow'], ['terminal.ansiBlue', 'blue'], ['terminal.ansiMagenta', 'magenta'],
  ['terminal.ansiCyan', 'cyan'], ['terminal.ansiWhite', 'white'],
  ['terminal.ansiBrightBlack', 'brightBlack'], ['terminal.ansiBrightRed', 'brightRed'],
  ['terminal.ansiBrightGreen', 'brightGreen'], ['terminal.ansiBrightYellow', 'brightYellow'],
  ['terminal.ansiBrightBlue', 'brightBlue'], ['terminal.ansiBrightMagenta', 'brightMagenta'],
  ['terminal.ansiBrightCyan', 'brightCyan'], ['terminal.ansiBrightWhite', 'brightWhite'],
] as const;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAt(colors: Record<string, unknown>, key: string): string | undefined {
  const value = colors[key];
  return typeof value === 'string' ? value : undefined;
}

/** Relative-luminance-based dark/light guess for a theme with no `type`. */
function luminanceType(hex: string | undefined): ColorThemeType | undefined {
  if (hex === undefined) return undefined;
  const digits = toOpaqueHex(hex).replace('#', '');
  if (digits.length < 6) return undefined;
  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return undefined;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.5 ? 'dark' : 'light';
}

function resolveType(raw: Record<string, unknown>, colors: Record<string, unknown>, warnings: string[]): ColorThemeType {
  const rawType = raw.type;
  if (rawType === 'dark' || rawType === 'hc-black' || rawType === 'hcDark') return 'dark';
  if (rawType === 'light' || rawType === 'hc-light' || rawType === 'hcLight') return 'light';

  const guessed = luminanceType(stringAt(colors, 'editor.background'));
  if (guessed !== undefined) return guessed;

  warnings.push('could not determine light/dark type; defaulting to dark');
  return 'dark';
}

/** Parses VS Code theme JSON(C) text into a plain object; throws ColorThemeImportError. */
export function parseVsCodeThemeText(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  // jsonc-parser reports a leading UTF-8 BOM as a parse error at offset 0; Windows-authored themes often carry one.
  const parsed = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    throw new ColorThemeImportError(`invalid JSON at offset ${errors[0]!.offset}`);
  }
  if (!isPlainObject(parsed)) {
    throw new ColorThemeImportError('theme file must contain a JSON object');
  }
  return parsed;
}

/** Maps a parsed VS Code theme object to a color theme plus warnings. */
export function mapVsCodeThemeObject(parsed: Record<string, unknown>, fileName: string): { theme: ColorTheme; warnings: string[] } {
  const warnings: string[] = [];
  const colors = isPlainObject(parsed.colors) ? parsed.colors : {};

  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fileName.replace(/\.jsonc?$/i, '');
  const type = resolveType(parsed, colors, warnings);

  const terminal: Record<string, string> = {};
  const background = stringAt(colors, 'terminal.background');
  const foreground = stringAt(colors, 'terminal.foreground');
  if (background !== undefined) terminal.background = background;
  if (foreground !== undefined) terminal.foreground = foreground;
  const cursor = stringAt(colors, 'terminalCursor.foreground');
  const cursorAccent = stringAt(colors, 'terminalCursor.background');
  if (cursor !== undefined) terminal.cursor = cursor;
  if (cursorAccent !== undefined) terminal.cursorAccent = cursorAccent;
  const selectionBackground = stringAt(colors, 'terminal.selectionBackground');
  if (selectionBackground !== undefined) terminal.selectionBackground = selectionBackground;
  for (const [vscodeKey, paletteKey] of TERMINAL_ANSI_KEYS) {
    const value = stringAt(colors, vscodeKey);
    if (value !== undefined) terminal[paletteKey] = value;
  }

  const ui: Record<string, string> = {};
  const editorBackground = stringAt(colors, 'editor.background');
  const editorForeground = stringAt(colors, 'editor.foreground');
  if (editorBackground !== undefined) ui.background = editorBackground;
  const sideBarBackground = stringAt(colors, 'sideBar.background');
  if (sideBarBackground !== undefined) ui.surface = sideBarBackground;
  const overlayBackground = stringAt(colors, 'quickInput.background') ?? stringAt(colors, 'editorWidget.background');
  if (overlayBackground !== undefined) {
    ui.overlay = /^#[0-9a-f]{3,8}$/i.test(overlayBackground) ? toOpaqueHex(overlayBackground) : overlayBackground;
  }
  const panelBorder = stringAt(colors, 'panel.border');
  if (panelBorder !== undefined) ui.border = panelBorder;
  const uiForeground = editorForeground ?? stringAt(colors, 'foreground');
  if (uiForeground !== undefined) ui.foreground = uiForeground;
  const descriptionForeground = stringAt(colors, 'descriptionForeground');
  if (descriptionForeground !== undefined) ui.muted = descriptionForeground;
  const focusBorder = stringAt(colors, 'focusBorder');
  if (focusBorder !== undefined) ui.accent = focusBorder;

  let tokenColors: unknown[] | undefined;
  if (typeof parsed.tokenColors === 'string') {
    warnings.push('tokenColors is a path to another file; single-file import cannot resolve it, so this theme imports without syntax');
  } else if (Array.isArray(parsed.tokenColors)) {
    tokenColors = parsed.tokenColors;
  }

  if (parsed.include !== undefined) {
    warnings.push('"include" is not supported for single-file import; colors from the included file are missing');
  }

  const syntaxColors: Record<string, string> = {};
  if (editorBackground !== undefined) syntaxColors['editor.background'] = editorBackground;
  if (editorForeground !== undefined) syntaxColors['editor.foreground'] = editorForeground;

  const raw: Record<string, unknown> = { name, type };
  if (Object.keys(terminal).length > 0) raw.terminal = terminal;
  if (Object.keys(ui).length > 0) raw.ui = ui;
  if (tokenColors !== undefined || Object.keys(syntaxColors).length > 0) {
    raw.syntax = {
      ...(Object.keys(syntaxColors).length > 0 ? { colors: syntaxColors } : {}),
      tokenColors: tokenColors ?? [],
    };
  }
  raw.source = { kind: 'vscode-import', fileName, importedAt: new Date().toISOString() };

  const result = normalizeColorTheme(raw, 'pending');
  if ('errors' in result) {
    throw new ColorThemeImportError(result.errors.join('; '));
  }
  return { theme: result.theme, warnings: [...warnings, ...result.warnings] };
}

/** Parses a VS Code theme JSON(C) file and maps it to a color theme plus warnings. */
export function mapVsCodeTheme(text: string, fileName: string): { theme: ColorTheme; warnings: string[] } {
  return mapVsCodeThemeObject(parseVsCodeThemeText(text), fileName);
}
