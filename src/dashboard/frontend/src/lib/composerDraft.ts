// ─── Draft persistence ────────────────────────────────────────────────────────

function getDraftKey(conversationName: string): string {
  return `conv-draft:${conversationName}`;
}

export function loadDraft(conversationName: string): string {
  try {
    return localStorage.getItem(getDraftKey(conversationName)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(conversationName: string, text: string): void {
  try {
    if (text) {
      localStorage.setItem(getDraftKey(conversationName), text);
    } else {
      localStorage.removeItem(getDraftKey(conversationName));
    }
  } catch {
    // Storage full or unavailable
  }
}

/** Remove a conversation's saved draft at once (PAN-5184: sent text must not come back on reload). */
export function clearDraft(conversationName: string): void {
  saveDraft(conversationName, '');
}

/** PAN-5236: true when any conversation has unsent text saved. */
export function hasSavedDraft(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('conv-draft:') && localStorage.getItem(key)) return true;
    }
  } catch {
    // Storage unavailable
  }
  return false;
}
