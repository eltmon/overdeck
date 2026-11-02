// Color theme model (PAN-4644). A color theme is a named set of colors with
// a `type` ("light" | "dark") and three optional groups: `terminal`,
// `syntax`, `ui`. Pure TypeScript — no Node or DOM imports, so this module
// can be shared by the server, the CLI, and the frontend.

export type ColorThemeType = "light" | "dark"

/** The 21 keys xterm.js needs: background/foreground/cursor state plus the 16 ANSI colors. */
export interface TerminalPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

const TERMINAL_PALETTE_KEYS: ReadonlyArray<keyof TerminalPalette> = [
  "background", "foreground", "cursor", "cursorAccent", "selectionBackground",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
]

/** The documented subset of dashboard UI tokens a theme may override. Signal/state tokens are never in this list. */
export interface ColorThemeUi {
  background?: string
  surface?: string
  /** Modal/dialog surface (PAN-4755). */
  overlay?: string
  border?: string
  foreground?: string
  muted?: string
  accent?: string
}

const UI_KEYS: ReadonlyArray<keyof ColorThemeUi> = ["background", "surface", "overlay", "border", "foreground", "muted", "accent"]

export interface TokenColorSettings {
  foreground?: string
  background?: string
  fontStyle?: string
}

export interface TokenColorEntry {
  scope?: string | string[]
  settings: TokenColorSettings
}

export interface ColorThemeSyntax {
  colors?: {
    "editor.background"?: string
    "editor.foreground"?: string
  }
  tokenColors: TokenColorEntry[]
}

export interface ColorThemeSource {
  kind: "vscode-import"
  fileName: string
  importedAt: string
}

/** The theme as it lives on disk / is sent in a save request: no id, no builtin flag. */
export interface ColorThemeFile {
  name: string
  type: ColorThemeType
  terminal?: Partial<TerminalPalette>
  syntax?: ColorThemeSyntax
  ui?: ColorThemeUi
  source?: ColorThemeSource
}

/** The theme as the wire and the store hand it back: the file fields plus id and builtin. */
export interface ColorTheme extends ColorThemeFile {
  id: string
  builtin: boolean
}

export interface ColorThemesListResponse {
  themes: ColorTheme[]
  selection: { light: string; dark: string }
  warnings: string[]
}

export interface ColorThemeImportPreviewResponse {
  themes: ColorTheme[]
  warnings: string[]
}

export const COLOR_THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export const RESERVED_COLOR_THEME_IDS: readonly string[] = ["overdeck-dark", "overdeck-light"]

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const FONT_STYLE_RE = /^[a-z ]*$/i

// Byte-for-byte copies of XTerminal.tsx's xtermTheme(isDark) palettes
// (src/dashboard/frontend/src/components/XTerminal.tsx:29-46). Built-in
// themes carry no syntax/ui group, so selecting them changes nothing visible.
export const BUILTIN_COLOR_THEMES: Readonly<Record<"overdeck-dark" | "overdeck-light", ColorTheme>> = {
  "overdeck-dark": {
    id: "overdeck-dark",
    name: "Overdeck Dark",
    type: "dark",
    builtin: true,
    terminal: {
      background: "#1a1a2e", foreground: "#eaeaea", cursor: "#eaeaea", cursorAccent: "#1a1a2e",
      selectionBackground: "#3a3a5e",
      black: "#1a1a2e", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#6272a4",
      magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5",
      brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  "overdeck-light": {
    id: "overdeck-light",
    name: "Overdeck Light",
    type: "light",
    builtin: true,
    terminal: {
      background: "#ffffff", foreground: "#24292e", cursor: "#24292e", cursorAccent: "#ffffff",
      selectionBackground: "#bcd3f5",
      black: "#24292e", red: "#d73a49", green: "#22863a", yellow: "#b08800", blue: "#0366d6",
      magenta: "#6f42c1", cyan: "#1b7c83", white: "#6a737d",
      brightBlack: "#959da5", brightRed: "#cb2431", brightGreen: "#28a745", brightYellow: "#dbab09",
      brightBlue: "#2188ff", brightMagenta: "#8a63d2", brightCyan: "#3192aa", brightWhite: "#24292e",
    },
  },
}

export function builtinFor(type: ColorThemeType): ColorTheme {
  return type === "dark" ? BUILTIN_COLOR_THEMES["overdeck-dark"] : BUILTIN_COLOR_THEMES["overdeck-light"]
}

/** Expands "#rgb" to "#rrggbb" and drops an alpha channel, lowercased, so xterm and tmux render the same opaque color. */
export function toOpaqueHex(hex: string): string {
  const lower = hex.toLowerCase()
  const digits = lower.slice(1)
  if (digits.length === 3) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
  }
  if (digits.length === 4) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
  }
  if (digits.length === 8) {
    return `#${digits.slice(0, 6)}`
  }
  return lower
}

/** WCAG-contrast-based readable text color for a background hex: whichever of black/white has the higher contrast ratio. */
export function readableForeground(hex: string): string {
  const opaque = toOpaqueHex(hex)
  const r = parseInt(opaque.slice(1, 3), 16) / 255
  const g = parseInt(opaque.slice(3, 5), 16) / 255
  const b = parseInt(opaque.slice(5, 7), 16) / 255
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  // WCAG contrast ratio: (lighter + 0.05) / (darker + 0.05). Black has
  // luminance 0, white has luminance 1 — compare both ratios instead of a
  // flat 0.5 cutoff, which picks white over black for e.g. #888888 even
  // though black has the higher actual contrast (PAN-4644 review).
  const contrastWithWhite = (1 + 0.05) / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / (0 + 0.05)
  return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff"
}

/** Lowercase slug: runs of non-[a-z0-9] become "-", trimmed, capped at 64 chars, "theme" if empty. */
export function slugifyThemeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  return slug.length > 0 ? slug : "theme"
}

/** The built-in palette for the theme's type, overlaid with the theme's own terminal colors. */
export function effectiveTerminalPalette(theme: { type: ColorThemeType; terminal?: Partial<TerminalPalette> }): TerminalPalette {
  const palette: TerminalPalette = { ...(builtinFor(theme.type).terminal as TerminalPalette), ...theme.terminal }
  return { ...palette, background: toOpaqueHex(palette.background) }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeSource(raw: unknown): ColorThemeSource | undefined {
  if (!isPlainObject(raw)) return undefined
  if (raw.kind !== "vscode-import") return undefined
  if (typeof raw.fileName !== "string" || typeof raw.importedAt !== "string") return undefined
  return { kind: "vscode-import", fileName: raw.fileName, importedAt: raw.importedAt }
}

function normalizeTerminal(raw: unknown, warnings: string[]): Partial<TerminalPalette> | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    warnings.push("terminal must be an object; ignoring")
    return undefined
  }
  const result: Partial<TerminalPalette> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!TERMINAL_PALETTE_KEYS.includes(key as keyof TerminalPalette)) {
      warnings.push(`unknown terminal key terminal.${key}; dropping`)
      continue
    }
    if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
      warnings.push(`invalid color for terminal.${key}; dropping`)
      continue
    }
    result[key as keyof TerminalPalette] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeUi(raw: unknown, warnings: string[]): ColorThemeUi | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    warnings.push("ui must be an object; ignoring")
    return undefined
  }
  const result: ColorThemeUi = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!UI_KEYS.includes(key as keyof ColorThemeUi)) {
      warnings.push(`unknown ui key ui.${key}; dropping`)
      continue
    }
    if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
      warnings.push(`invalid color for ui.${key}; dropping`)
      continue
    }
    result[key as keyof ColorThemeUi] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeTokenColors(raw: unknown, warnings: string[]): TokenColorEntry[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    warnings.push("syntax.tokenColors must be an array; ignoring")
    return []
  }
  const entries: TokenColorEntry[] = []
  for (const entry of raw.slice(0, 2000)) {
    if (!isPlainObject(entry) || !isPlainObject(entry.settings)) continue
    const settings: TokenColorSettings = {}
    const rawSettings = entry.settings
    if (typeof rawSettings.foreground === "string" && HEX_COLOR_RE.test(rawSettings.foreground)) {
      settings.foreground = rawSettings.foreground
    }
    if (typeof rawSettings.background === "string" && HEX_COLOR_RE.test(rawSettings.background)) {
      settings.background = rawSettings.background
    }
    if (typeof rawSettings.fontStyle === "string" && FONT_STYLE_RE.test(rawSettings.fontStyle)) {
      settings.fontStyle = rawSettings.fontStyle
    }
    const result: TokenColorEntry = { settings }
    if (typeof entry.scope === "string") {
      result.scope = entry.scope
    } else if (Array.isArray(entry.scope) && entry.scope.every(s => typeof s === "string")) {
      result.scope = entry.scope as string[]
    }
    entries.push(result)
  }
  return entries
}

function normalizeSyntax(raw: unknown, warnings: string[]): ColorThemeSyntax | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    warnings.push("syntax must be an object; ignoring")
    return undefined
  }
  const tokenColors = normalizeTokenColors(raw.tokenColors, warnings)
  let colors: ColorThemeSyntax["colors"]
  if (isPlainObject(raw.colors)) {
    const filtered: NonNullable<ColorThemeSyntax["colors"]> = {}
    const background = raw.colors["editor.background"]
    const foreground = raw.colors["editor.foreground"]
    if (typeof background === "string" && HEX_COLOR_RE.test(background)) filtered["editor.background"] = background
    if (typeof foreground === "string" && HEX_COLOR_RE.test(foreground)) filtered["editor.foreground"] = foreground
    if (Object.keys(filtered).length > 0) colors = filtered
  }
  if (tokenColors.length === 0 && colors === undefined) return undefined
  return { tokenColors, ...(colors !== undefined ? { colors } : {}) }
}

/**
 * Validates and sanitizes a raw theme. An invalid color or unknown key is
 * dropped with a warning naming it — never an error. A missing/invalid
 * `name` or `type` is an error: there is no sensible default for either.
 */
export function normalizeColorTheme(raw: unknown, id: string): { theme: ColorTheme; warnings: string[] } | { errors: string[] } {
  const errors: string[] = []
  if (!isPlainObject(raw)) {
    return { errors: ["theme must be an object"] }
  }

  const rawName = raw.name
  let name: string | undefined
  if (typeof rawName === "string" && rawName.trim().length > 0) {
    name = rawName.trim().slice(0, 80)
  } else {
    errors.push("name is required")
  }

  const rawType = raw.type
  let type: ColorThemeType | undefined
  if (rawType === "light" || rawType === "dark") {
    type = rawType
  } else {
    errors.push("type must be \"light\" or \"dark\"")
  }

  if (errors.length > 0 || name === undefined || type === undefined) {
    return { errors }
  }

  const warnings: string[] = []
  const terminal = normalizeTerminal(raw.terminal, warnings)
  const ui = normalizeUi(raw.ui, warnings)
  const syntax = normalizeSyntax(raw.syntax, warnings)
  const source = normalizeSource(raw.source)

  const theme: ColorTheme = {
    id,
    builtin: false,
    name,
    type,
    ...(terminal !== undefined ? { terminal } : {}),
    ...(syntax !== undefined ? { syntax } : {}),
    ...(ui !== undefined ? { ui } : {}),
    ...(source !== undefined ? { source } : {}),
  }

  return { theme, warnings }
}
