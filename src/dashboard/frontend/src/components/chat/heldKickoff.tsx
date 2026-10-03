/**
 * PAN-4499 WI-8: the held-conversation composer — a `--hold` successor shows
 * its stored kickoff and waits for the operator to press Send instead of
 * sending on its own. Plain fetch + polling (not react-query's useQuery): six
 * other test files mount `ComposerFooter` with no `QueryClientProvider`
 * ancestor, and an unconditional `useQuery` call there would break every one.
 */
import { useEffect, useRef, useState } from 'react';
import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { fetchWithTimeout } from '../../lib/apiFetch';
import styles from '../CommandDeck/styles/command-deck.module.css';

export interface HeldKickoff {
  held: boolean;
  text?: string;
}

export class HeldKickoffConflictError extends Error {}

async function fetchHeldKickoff(name: string, signal?: AbortSignal): Promise<HeldKickoff> {
  const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(name)}/kickoff`, { signal });
  if (!res.ok) return { held: false };
  try {
    // .clone() so reading this body never consumes a Response another fetch
    // consumer (e.g. a test's blanket fetch mock shared across endpoints) still
    // needs to read.
    return (await res.clone().json()) as HeldKickoff;
  } catch {
    return { held: false };
  }
}

/** Polls the kickoff door every 5s while held; stops once the conversation starts. */
export function useHeldKickoff(conversationName: string): HeldKickoff & { refresh: () => void } {
  const [state, setState] = useState<HeldKickoff>({ held: false });
  const heldRef = useRef(false);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = () => {
      void fetchHeldKickoff(conversationName, controller.signal)
        .then((next) => {
          if (cancelled) return;
          heldRef.current = next.held;
          setState(next);
        })
        .catch(() => { /* keep the last known state on a transient fetch failure */ });
    };
    loadRef.current = load;
    load();
    const interval = setInterval(() => { if (heldRef.current) load(); }, 5000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [conversationName]);

  return { ...state, refresh: () => loadRef.current() };
}

/** POSTs the kickoff door. Throws HeldKickoffConflictError on 409, Error(body.error) otherwise. */
export async function startHeldKickoff(name: string, text?: string): Promise<void> {
  const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(name)}/kickoff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(text !== undefined ? { text } : {}),
  });
  if (res.ok) return;
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON body — keep the status code */
  }
  if (res.status === 409) throw new HeldKickoffConflictError(message);
  throw new Error(message);
}

/** Whitespace-collapsed-and-trimmed equality: an untouched kickoff needs no edited text sent. */
export function kickoffUnchanged(composerText: string, kickoff: string | undefined): boolean {
  if (kickoff === undefined) return true;
  const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();
  return collapse(composerText) === collapse(kickoff);
}

/** Seeds the composer with the held kickoff, once per conversation, only into an empty editor. */
export function useSeedHeldKickoff(editor: LexicalEditor | null, conversationName: string, held: boolean, text: string | undefined): void {
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !held || !text || seededForRef.current === conversationName) return;
    seededForRef.current = conversationName;
    let isEmpty = true;
    editor.read(() => { isEmpty = $getRoot().getTextContent().trim() === ''; });
    if (!isEmpty) return;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      for (const line of text.split('\n')) {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(line));
        root.append(paragraph);
      }
    });
  }, [editor, conversationName, held, text]);
}

export function HeldKickoffNotice() {
  return (
    <div className={styles.composerBox} role="status" data-testid="held-kickoff-notice">
      <p>Waiting to start. The handoff kickoff is in the composer — press Send to start this conversation.</p>
    </div>
  );
}
