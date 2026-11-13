/**
 * Code pane drafts (PAN-5187, FR-7, NFR-6).
 *
 * The in-memory text of every open code pane, keyed by (rootId, path). It
 * lives in a module-level zustand store, so closing a pane or switching
 * tabs never loses unsaved text, and nothing is persisted.
 *
 * A draft has a base: the text and disk signature last loaded from or
 * saved to disk. The draft is dirty when its text differs from the base
 * text. The base signature is the `expectedSignature` every save sends.
 *
 * This module must not import from components/Stage/ (PaneBar imports it).
 */
import { create } from 'zustand';

export interface CodeDraft {
  text: string;
  baseText: string;
  baseSignature: string;
}

export const draftKey = (rootId: string, path: string): string => `${rootId}\u0000${path}`;

export const isDraftDirty = (draft: CodeDraft | undefined): boolean => draft !== undefined && draft.text !== draft.baseText;

export interface CodeDraftsState {
  drafts: Record<string, CodeDraft>;
  /**
   * Disk content arrived. A missing or clean draft takes it as text and
   * base. A dirty draft keeps its text: it takes the new base only when the
   * disk content is the same as the old base or the same as the draft
   * text. Returns false when a dirty draft was left untouched because disk
   * holds other content; the caller then raises the external-change state.
   */
  loaded(key: string, text: string, signature: string): boolean;
  edited(key: string, text: string): void;
  /** A save of `text` returned `signature`. The draft stays dirty if it changed since. */
  saved(key: string, text: string, signature: string): void;
  /** Reload from disk: discard edits. */
  reset(key: string, text: string, signature: string): void;
  /** Keep my edits: base becomes the disk content; text is kept. */
  keepMine(key: string, diskText: string, diskSignature: string): void;
  /** Move a draft to a new key (a rename on disk or in the tree). */
  rekey(fromKey: string, toKey: string): void;
  drop(key: string): void;
}

const fresh = (text: string, signature: string): CodeDraft => ({ text, baseText: text, baseSignature: signature });

export const useCodeDrafts = create<CodeDraftsState>((set, get) => {
  const put = (key: string, draft: CodeDraft) => set((s) => ({ drafts: { ...s.drafts, [key]: draft } }));
  return {
    drafts: {},
    loaded: (key, text, signature) => {
      const draft = get().drafts[key];
      if (!isDraftDirty(draft)) {
        put(key, fresh(text, signature));
        return true;
      }
      if (signature === draft!.baseSignature || text === draft!.text) {
        put(key, { text: draft!.text, baseText: text, baseSignature: signature });
        return true;
      }
      return false;
    },
    edited: (key, text) => {
      const draft = get().drafts[key];
      if (draft && draft.text !== text) put(key, { ...draft, text });
    },
    saved: (key, text, signature) => {
      const draft = get().drafts[key];
      put(key, { text: draft?.text ?? text, baseText: text, baseSignature: signature });
    },
    reset: (key, text, signature) => put(key, fresh(text, signature)),
    keepMine: (key, diskText, diskSignature) => {
      const draft = get().drafts[key];
      put(key, { text: draft?.text ?? diskText, baseText: diskText, baseSignature: diskSignature });
    },
    rekey: (fromKey, toKey) => {
      if (fromKey === toKey) return;
      set((s) => {
        const draft = s.drafts[fromKey];
        if (!draft) return s;
        const { [fromKey]: _moved, ...rest } = s.drafts;
        return { drafts: { ...rest, [toKey]: draft } };
      });
    },
    drop: (key) =>
      set((s) => {
        if (!(key in s.drafts)) return s;
        const { [key]: _dropped, ...rest } = s.drafts;
        return { drafts: rest };
      }),
  };
});

/** Selector: is the draft for (rootId, path) dirty? False when either is missing. */
export const selectIsDirty =
  (rootId?: string, path?: string) =>
  (s: CodeDraftsState): boolean =>
    rootId !== undefined && path !== undefined && isDraftDirty(s.drafts[draftKey(rootId, path)]);
