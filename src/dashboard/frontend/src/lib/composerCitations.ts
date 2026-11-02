/**
 * composerCitations — per-conversation pending citations, persisted to
 * `localStorage` so a selected-and-annotated quote survives a reload (unlike
 * `composerStore`'s in-memory-only attachment state).
 *
 * PAN-4642 WI-3.
 */
import { createContext, useContext } from 'react';
import { create } from 'zustand';
import type { CitationSource, PendingCitation } from './citationFormat';

const STORAGE_PREFIX = 'conv-citations:';

function storageKey(conversationName: string): string {
  return `${STORAGE_PREFIX}${conversationName}`;
}

function isCitationSource(value: unknown): value is CitationSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  if (source.kind === 'message') {
    return (
      typeof source.messageId === 'string' &&
      (source.role === 'assistant' || source.role === 'user')
    );
  }
  if (source.kind === 'file') {
    return typeof source.path === 'string' && source.path !== '';
  }
  return false;
}

/** The conversation whose composer should receive a citation made elsewhere (e.g. an editor pane). */
export const CitationTargetContext = createContext<string | null>(null);

export function useCitationTarget(): string | null {
  return useContext(CitationTargetContext);
}

function isPendingCitation(value: unknown): value is PendingCitation {
  if (!value || typeof value !== 'object') return false;
  const citation = value as Record<string, unknown>;
  return (
    typeof citation.id === 'string' &&
    typeof citation.quotedText === 'string' &&
    typeof citation.comment === 'string' &&
    typeof citation.createdAt === 'string' &&
    isCitationSource(citation.source)
  );
}

function readStoredCitations(conversationName: string): PendingCitation[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(conversationName));
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as { v?: unknown; citations?: unknown };
    if (parsed.v !== 1 || !Array.isArray(parsed.citations)) return [];
    return parsed.citations.filter(isPendingCitation);
  } catch {
    return [];
  }
}

function loadAllFromStorage(): Record<string, PendingCitation[]> {
  const byConversation: Record<string, PendingCitation[]> = {};
  let keys: string[];
  try {
    keys = Object.keys(localStorage);
  } catch {
    return byConversation;
  }

  for (const key of keys) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    const conversationName = key.slice(STORAGE_PREFIX.length);
    const citations = readStoredCitations(conversationName);
    if (citations.length > 0) byConversation[conversationName] = citations;
  }
  return byConversation;
}

function writeStoredCitations(conversationName: string, citations: PendingCitation[]): void {
  try {
    if (citations.length === 0) {
      localStorage.removeItem(storageKey(conversationName));
    } else {
      localStorage.setItem(storageKey(conversationName), JSON.stringify({ v: 1, citations }));
    }
  } catch {
    // Best-effort persistence; the in-memory store stays authoritative for this session.
  }
}

interface CitationStore {
  byConversation: Record<string, PendingCitation[]>;
  reset(): void;
  add(conversationName: string, citation: PendingCitation): void;
  updateComment(conversationName: string, id: string, comment: string): void;
  remove(conversationName: string, id: string): void;
  consume(conversationName: string): void;
}

const EMPTY_CITATIONS: PendingCitation[] = [];

export const useCitationStore = create<CitationStore>((set) => ({
  byConversation: loadAllFromStorage(),
  reset: () => set({ byConversation: loadAllFromStorage() }),
  add: (conversationName, citation) =>
    set((state) => {
      const next = [...(state.byConversation[conversationName] ?? []), citation];
      writeStoredCitations(conversationName, next);
      return { byConversation: { ...state.byConversation, [conversationName]: next } };
    }),
  updateComment: (conversationName, id, comment) =>
    set((state) => {
      const current = state.byConversation[conversationName];
      if (!current) return state;
      const next = current.map((c) => (c.id === id ? { ...c, comment: comment.trim() } : c));
      writeStoredCitations(conversationName, next);
      return { byConversation: { ...state.byConversation, [conversationName]: next } };
    }),
  remove: (conversationName, id) =>
    set((state) => {
      const current = state.byConversation[conversationName];
      if (!current) return state;
      const next = current.filter((c) => c.id !== id);
      writeStoredCitations(conversationName, next);
      return { byConversation: { ...state.byConversation, [conversationName]: next } };
    }),
  consume: (conversationName) =>
    set((state) => {
      if (!(conversationName in state.byConversation)) return state;
      writeStoredCitations(conversationName, []);
      const next = { ...state.byConversation };
      delete next[conversationName];
      return { byConversation: next };
    }),
}));

export function useConversationCitations(conversationName: string): PendingCitation[] {
  return useCitationStore((s) => s.byConversation[conversationName] ?? EMPTY_CITATIONS);
}

export function getConversationCitations(conversationName: string): PendingCitation[] {
  return useCitationStore.getState().byConversation[conversationName] ?? EMPTY_CITATIONS;
}

export function addCitation(
  conversationName: string,
  input: { source: CitationSource; quotedText: string; comment: string },
): PendingCitation | null {
  const quotedText = input.quotedText.trim();
  if (quotedText === '') return null;

  const citation: PendingCitation = {
    id: crypto.randomUUID(),
    source: input.source,
    quotedText,
    comment: input.comment.trim(),
    createdAt: new Date().toISOString(),
  };
  useCitationStore.getState().add(conversationName, citation);
  return citation;
}

export function updateCitationComment(conversationName: string, id: string, comment: string): void {
  useCitationStore.getState().updateComment(conversationName, id, comment);
}

export function removeCitation(conversationName: string, id: string): void {
  useCitationStore.getState().remove(conversationName, id);
}

export function consumeCitations(conversationName: string): void {
  useCitationStore.getState().consume(conversationName);
}

/** Test-only: rebuilds the in-memory map from `localStorage` (reload simulation). */
export function resetCitationStore(): void {
  useCitationStore.getState().reset();
}
