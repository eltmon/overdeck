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
