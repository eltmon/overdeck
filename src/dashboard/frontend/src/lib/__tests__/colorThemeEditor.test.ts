import { describe, expect, it } from 'vitest';
import { BUILTIN_COLOR_THEMES, type ColorTheme, type ColorThemeSyntax } from '@overdeck/contracts';
import {
  applySyntaxEdits,
  createDraft,
  draftToFile,
  duplicateThemeName,
  pickerValue,
  revertEdit,
  setEdit,
  syntaxForeground,
} from '../colorThemeEditor';

describe('duplicateThemeName', () => {
  it('"Overdeck Dark" with no clash becomes "Overdeck Dark copy"', () => {
    expect(duplicateThemeName('Overdeck Dark', [])).toBe('Overdeck Dark copy');
  });

  it('with "overdeck dark copy" taken, becomes "Overdeck Dark copy 2"', () => {
    expect(duplicateThemeName('Overdeck Dark', ['overdeck dark copy'])).toBe('Overdeck Dark copy 2');
  });

  it('with copy and copy 2 taken, becomes "Overdeck Dark copy 3"', () => {
    expect(duplicateThemeName('Overdeck Dark', ['Overdeck Dark copy', 'Overdeck Dark copy 2'])).toBe('Overdeck Dark copy 3');
  });

  it('an 80-char source name produces a result at most 80 chars, ending with " copy"', () => {
    const longName = 'a'.repeat(80);
    const result = duplicateThemeName(longName, []);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith(' copy')).toBe(true);
  });
});

describe('createDraft', () => {
  it('duplicating overdeck-dark gives name "Overdeck Dark copy" and draftToFile with the full terminal palette, no ui/syntax/source', () => {
    const draft = createDraft(BUILTIN_COLOR_THEMES['overdeck-dark'], 'duplicate', []);
    expect(draft.name).toBe('Overdeck Dark copy');

    const file = draftToFile(draft);
    expect(file.type).toBe('dark');
    expect(file.terminal).toEqual(BUILTIN_COLOR_THEMES['overdeck-dark'].terminal);
    expect(file.ui).toBeUndefined();
    expect(file.syntax).toBeUndefined();
    expect(file.source).toBeUndefined();
  });

  it('throws for edit mode on a built-in theme', () => {
    expect(() => createDraft(BUILTIN_COLOR_THEMES['overdeck-dark'], 'edit', [])).toThrow();
  });

  it('edit mode on a user theme with a source keeps it in draftToFile; duplicate mode drops it', () => {
    const userTheme: ColorTheme = {
      id: 'ayu-dark',
      builtin: false,
      name: 'Ayu Dark',
      type: 'dark',
      source: { kind: 'vscode-import', fileName: 'ayu-dark.json', importedAt: '2026-01-01T00:00:00.000Z' },
    };

    const editDraft = createDraft(userTheme, 'edit', []);
    expect(draftToFile(editDraft).source).toEqual(userTheme.source);

    const duplicateDraft = createDraft(userTheme, 'duplicate', []);
    expect(draftToFile(duplicateDraft).source).toBeUndefined();
  });
});

describe('draftToFile', () => {
  it('never mutates the source theme', () => {
    const source = BUILTIN_COLOR_THEMES['overdeck-dark'];
    const before = JSON.parse(JSON.stringify(source));
    const draft = createDraft(source, 'duplicate', []);
    const edited = setEdit(draft, 'terminal', 'background', '#000000');
    draftToFile(edited);
    expect(JSON.parse(JSON.stringify(source))).toEqual(before);
  });
});

describe('syntaxForeground', () => {
  const syntax: ColorThemeSyntax = {
    tokenColors: [
      { scope: 'comment, punctuation.definition.comment', settings: { foreground: '#6272a4' } },
    ],
  };

  it('finds "comment" in a comma-separated scope list', () => {
    expect(syntaxForeground(syntax, 'comment')).toBe('#6272a4');
  });

  it('the last matching entry wins', () => {
    const multi: ColorThemeSyntax = {
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#111111' } },
        { scope: 'comment', settings: { foreground: '#222222' } },
      ],
    };
    expect(syntaxForeground(multi, 'comment')).toBe('#222222');
  });

  it('returns undefined when absent', () => {
    expect(syntaxForeground(syntax, 'keyword')).toBeUndefined();
    expect(syntaxForeground(undefined, 'comment')).toBeUndefined();
  });
});

describe('applySyntaxEdits', () => {
  it('no edits returns the same reference, including undefined', () => {
    const syntax: ColorThemeSyntax = { tokenColors: [] };
    expect(applySyntaxEdits(syntax, {})).toBe(syntax);
    expect(applySyntaxEdits(undefined, {})).toBeUndefined();
  });

  it('editing comment when an entry with scope "comment" exists updates its foreground and keeps fontStyle', () => {
    const syntax: ColorThemeSyntax = {
      tokenColors: [{ scope: 'comment', settings: { foreground: '#6272a4', fontStyle: 'italic' } }],
    };
    const result = applySyntaxEdits(syntax, { comment: '#ff0000' });
    expect(result?.tokenColors[0]).toEqual({ scope: 'comment', settings: { foreground: '#ff0000', fontStyle: 'italic' } });
  });

  it('editing function with no exact entry appends a new rule at the end; other entries keep reference and order', () => {
    const commentEntry = { scope: 'comment', settings: { foreground: '#6272a4' } };
    const keywordEntry = { scope: 'keyword', settings: { foreground: '#ff79c6' } };
    const syntax: ColorThemeSyntax = { tokenColors: [commentEntry, keywordEntry], colors: { 'editor.background': '#1a1a2e' } };

    const result = applySyntaxEdits(syntax, { function: '#50fa7b' });
    expect(result?.tokenColors).toHaveLength(3);
    expect(result?.tokenColors[0]).toBe(commentEntry);
    expect(result?.tokenColors[1]).toBe(keywordEntry);
    expect(result?.tokenColors[2]).toEqual({ scope: 'entity.name.function', settings: { foreground: '#50fa7b' } });
    expect(result?.colors).toEqual({ 'editor.background': '#1a1a2e' });
  });
});

describe('pickerValue', () => {
  it('an 8-digit selectionBackground shows its opaque form; draftToFile still writes the original when untouched', () => {
    const source: ColorTheme = {
      ...BUILTIN_COLOR_THEMES['overdeck-dark'],
      id: 'ayu-dark',
      builtin: false,
      terminal: { ...BUILTIN_COLOR_THEMES['overdeck-dark'].terminal, selectionBackground: '#264f78cc' },
    };
    const draft = createDraft(source, 'edit', []);
    expect(pickerValue(draft, 'terminal', 'selectionBackground').value).toBe('#264f78');
    expect(draftToFile(draft).terminal?.selectionBackground).toBe('#264f78cc');
  });

  it('a not-set ui.accent on a duplicate of overdeck-dark shows the palette blue, unset', () => {
    const draft = createDraft(BUILTIN_COLOR_THEMES['overdeck-dark'], 'duplicate', []);
    const before = pickerValue(draft, 'ui', 'accent');
    expect(before).toEqual({ value: '#6272a4', isSet: false, isEdited: false });

    const edited = setEdit(draft, 'ui', 'accent', '#ff0000');
    expect(pickerValue(edited, 'ui', 'accent')).toEqual({ value: '#ff0000', isSet: true, isEdited: true });

    const reverted = revertEdit(edited, 'ui', 'accent');
    expect(pickerValue(reverted, 'ui', 'accent')).toEqual({ value: '#6272a4', isSet: false, isEdited: false });
    expect(draftToFile(reverted).ui).toBeUndefined();
  });
});
