import {
  effectiveTerminalPalette,
  toOpaqueHex,
  type ColorTheme,
  type ColorThemeFile,
  type ColorThemeSyntax,
  type ColorThemeUi,
  type TerminalPalette,
} from '@overdeck/contracts';

export type EditorMode = 'duplicate' | 'edit';
export type UiKey = keyof ColorThemeUi;
export type SyntaxKey = 'comment' | 'string' | 'keyword' | 'function' | 'variable' | 'number' | 'type';

/** The 20 editable terminal keys (PAN-4660 D3/FR-3) — `cursorAccent` is deliberately not editable. */
export const EDITABLE_TERMINAL_KEYS: ReadonlyArray<keyof TerminalPalette> = [
  'background', 'foreground', 'cursor', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

export const EDITABLE_UI_KEYS: readonly UiKey[] = ['background', 'surface', 'overlay', 'border', 'foreground', 'muted', 'accent'];

/** The common syntax scopes table (D4): key, label, the TextMate scope string, and the effective-terminal-palette key it seeds from when not set. */
export const SYNTAX_SCOPES: ReadonlyArray<{ key: SyntaxKey; label: string; scope: string; seed: keyof TerminalPalette }> = [
  { key: 'comment', label: 'Comment', scope: 'comment', seed: 'brightBlack' },
  { key: 'string', label: 'String', scope: 'string', seed: 'green' },
  { key: 'keyword', label: 'Keyword', scope: 'keyword', seed: 'magenta' },
  { key: 'function', label: 'Function', scope: 'entity.name.function', seed: 'blue' },
  { key: 'variable', label: 'Variable', scope: 'variable', seed: 'foreground' },
  { key: 'number', label: 'Number', scope: 'constant.numeric', seed: 'yellow' },
  { key: 'type', label: 'Type', scope: 'entity.name.type', seed: 'cyan' },
];

/** Seeds for not-set `ui` keys (D5), read from the draft's effective terminal palette. */
export const UI_SEEDS: Readonly<Record<UiKey, keyof TerminalPalette>> = {
  background: 'background',
  surface: 'background',
  overlay: 'background',
  foreground: 'foreground',
  border: 'brightBlack',
  muted: 'brightBlack',
  accent: 'blue',
};

export interface ThemeEdits {
  terminal: Partial<TerminalPalette>;
  ui: Partial<Record<UiKey, string>>;
  syntax: Partial<Record<SyntaxKey, string>>;
}

export interface ThemeDraft {
  mode: EditorMode;
  source: ColorTheme;
  name: string;
  edits: ThemeEdits;
}

/** D7: "<name> copy", " copy 2", … — the first candidate not already taken (trimmed, lowercased), capped at 80 chars. */
export function duplicateThemeName(sourceName: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`;
    const base = sourceName.slice(0, Math.max(0, 80 - suffix.length));
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.trim().toLowerCase())) return candidate;
  }
}

/** Builds a fresh, unedited draft. Throws for an 'edit' draft on a built-in theme — built-ins are read-only. */
export function createDraft(source: ColorTheme, mode: EditorMode, existingNames: readonly string[]): ThemeDraft {
  if (mode === 'edit' && source.builtin) {
    throw new Error('built-in themes are read-only');
  }
  const name = mode === 'duplicate' ? duplicateThemeName(source.name, existingNames) : source.name;
  return { mode, source, name, edits: { terminal: {}, ui: {}, syntax: {} } };
}

function scopeList(scope: TokenColorEntryScope): string[] {
  if (Array.isArray(scope)) return scope;
  return scope.split(',').map((s) => s.trim());
}

type TokenColorEntryScope = NonNullable<ColorThemeSyntax['tokenColors'][number]['scope']>;

/** D4 read rule: scans `tokenColors` from last to first; the last entry whose scope list contains `scope` exactly wins. */
export function syntaxForeground(syntax: ColorThemeSyntax | undefined, scope: string): string | undefined {
  if (syntax === undefined) return undefined;
  const { tokenColors } = syntax;
  for (let i = tokenColors.length - 1; i >= 0; i--) {
    const entry = tokenColors[i];
    if (entry.settings.foreground === undefined || entry.scope === undefined) continue;
    if (scopeList(entry.scope).includes(scope)) return entry.settings.foreground;
  }
  return undefined;
}

/** D4 write rule: for each edited scope (in table order), replace the last entry whose scope is exactly that string, or append a new one. */
export function applySyntaxEdits(syntax: ColorThemeSyntax | undefined, edits: Partial<Record<SyntaxKey, string>>): ColorThemeSyntax | undefined {
  const editedScopes = SYNTAX_SCOPES.filter((def) => edits[def.key] !== undefined);
  if (editedScopes.length === 0) return syntax;

  const tokenColors = [...(syntax?.tokenColors ?? [])];
  for (const { key, scope } of editedScopes) {
    const color = edits[key] as string;
    let targetIndex = -1;
    for (let i = tokenColors.length - 1; i >= 0; i--) {
      const entryScope = tokenColors[i].scope;
      const isExactMatch = entryScope === scope || (Array.isArray(entryScope) && entryScope.length === 1 && entryScope[0] === scope);
      if (isExactMatch) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      tokenColors.push({ scope, settings: { foreground: color } });
    } else {
      const entry = tokenColors[targetIndex];
      tokenColors[targetIndex] = { ...entry, settings: { ...entry.settings, foreground: color } };
    }
  }

  return { ...(syntax ?? {}), tokenColors };
}

/** D3: the only function that turns a draft into the shape saved to disk / sent to the server. Never mutates `draft.source`. */
export function draftToFile(draft: ThemeDraft): ColorThemeFile {
  const { source, mode, name, edits } = draft;
  const terminal = { ...source.terminal, ...edits.terminal };
  const ui = { ...source.ui, ...edits.ui };
  const syntax = applySyntaxEdits(source.syntax, edits.syntax);

  const file: ColorThemeFile = { name: name.trim(), type: source.type };
  if (Object.keys(terminal).length > 0) file.terminal = terminal;
  if (Object.keys(ui).length > 0) file.ui = ui;
  if (syntax !== undefined) file.syntax = syntax;
  if (mode === 'edit' && source.source !== undefined) file.source = source.source;
  return file;
}

/** The live preview theme for a draft — never saved, only rendered. */
export function draftPreviewTheme(draft: ThemeDraft): ColorTheme {
  return { ...draftToFile(draft), id: draft.mode === 'edit' ? draft.source.id : 'draft', builtin: false };
}

/** D6: every picker value is `#rrggbb`. `isSet` reflects the edit or the source; a not-set `ui`/`syntax` key seeds from the draft's effective terminal palette. */
export function pickerValue(draft: ThemeDraft, group: 'terminal' | 'ui' | 'syntax', key: string): { value: string; isSet: boolean; isEdited: boolean } {
  if (group === 'terminal') {
    const k = key as keyof TerminalPalette;
    const isEdited = draft.edits.terminal[k] !== undefined;
    const raw = draft.edits.terminal[k] ?? draft.source.terminal?.[k] ?? effectiveTerminalPalette(draft.source)[k];
    return { value: toOpaqueHex(raw), isSet: true, isEdited };
  }

  if (group === 'ui') {
    const k = key as UiKey;
    const isEdited = draft.edits.ui[k] !== undefined;
    const raw = draft.edits.ui[k] ?? draft.source.ui?.[k];
    const isSet = raw !== undefined;
    const value = raw ?? effectiveTerminalPalette(draftPreviewTheme(draft))[UI_SEEDS[k]];
    return { value: toOpaqueHex(value), isSet, isEdited };
  }

  const k = key as SyntaxKey;
  const isEdited = draft.edits.syntax[k] !== undefined;
  const def = SYNTAX_SCOPES.find((s) => s.key === k);
  const sourceValue = def === undefined ? undefined : syntaxForeground(draft.source.syntax, def.scope);
  const raw = draft.edits.syntax[k] ?? sourceValue;
  const isSet = raw !== undefined;
  const value = raw ?? effectiveTerminalPalette(draftPreviewTheme(draft))[def?.seed ?? 'foreground'];
  return { value: toOpaqueHex(value), isSet, isEdited };
}

/** Immutable: records one edit without touching `draft.source`. */
export function setEdit(draft: ThemeDraft, group: 'terminal' | 'ui' | 'syntax', key: string, color: string): ThemeDraft {
  switch (group) {
    case 'terminal':
      return { ...draft, edits: { ...draft.edits, terminal: { ...draft.edits.terminal, [key]: color } } };
    case 'ui':
      return { ...draft, edits: { ...draft.edits, ui: { ...draft.edits.ui, [key]: color } } };
    case 'syntax':
      return { ...draft, edits: { ...draft.edits, syntax: { ...draft.edits.syntax, [key]: color } } };
  }
}

/** Immutable: deletes an edit, reverting the key to whatever the source (or seed) shows. */
export function revertEdit(draft: ThemeDraft, group: 'terminal' | 'ui' | 'syntax', key: string): ThemeDraft {
  switch (group) {
    case 'terminal': {
      const next = { ...draft.edits.terminal };
      delete next[key as keyof TerminalPalette];
      return { ...draft, edits: { ...draft.edits, terminal: next } };
    }
    case 'ui': {
      const next = { ...draft.edits.ui };
      delete next[key as UiKey];
      return { ...draft, edits: { ...draft.edits, ui: next } };
    }
    case 'syntax': {
      const next = { ...draft.edits.syntax };
      delete next[key as SyntaxKey];
      return { ...draft, edits: { ...draft.edits, syntax: next } };
    }
  }
}
