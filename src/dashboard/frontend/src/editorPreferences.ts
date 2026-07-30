import type { EditorId } from '@overdeck/contracts';

const STORAGE_KEY = 'overdeck:last-editor';

export function getPreferredEditor(): EditorId | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored as EditorId | null;
  } catch {
    return null;
  }
}

export function setPreferredEditor(editorId: EditorId): void {
  try {
    localStorage.setItem(STORAGE_KEY, editorId);
  } catch {
    // localStorage may be unavailable
  }
}

// PAN-3260 — separate from overdeck:last-editor (the external-editor
// preference): this key selects internal-vs-external for markdown chips
// specifically, defaulting to 'internal' per the issue's requested default.
const MARKDOWN_OPEN_TARGET_KEY = 'overdeck:markdown-open-target';

export type MarkdownOpenTarget = 'internal' | EditorId;

export function getMarkdownOpenTarget(): MarkdownOpenTarget {
  try {
    const stored = localStorage.getItem(MARKDOWN_OPEN_TARGET_KEY);
    return (stored as MarkdownOpenTarget | null) ?? 'internal';
  } catch {
    return 'internal';
  }
}

export function setMarkdownOpenTarget(target: MarkdownOpenTarget): void {
  try {
    localStorage.setItem(MARKDOWN_OPEN_TARGET_KEY, target);
  } catch {
    // localStorage may be unavailable
  }
}
