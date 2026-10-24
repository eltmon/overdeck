/**
 * PAN-4499 WI-8: the held-conversation composer — a `--hold` successor shows
 * its stored kickoff and waits for the operator to press Send instead of
 * sending on its own. Plain fetch + polling (not react-query's useQuery): six
 * other test files mount `ComposerFooter` with no `QueryClientProvider`
 * ancestor, and an unconditional `useQuery` call there would break every one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { fetchWithTimeout } from '../../lib/apiFetch';
import styles from '../CommandDeck/styles/command-deck.module.css';

export interface HeldKickoff {
  held: boolean;
  text?: string;
  /** PAN-4596: the trimmed handoff focus, when the fork request carried one. */
  focus?: string;
}

/**
 * PAN-4596: whether the lookup has answered. `loading` until the first answer
 * for this conversation, `ready` once one succeeded, `error` when every
 * attempt so far failed — so a caller never reads "not held" from a lookup
 * that has not answered yet.
 */
export type HeldKickoffStatus = 'loading' | 'ready' | 'error';

export interface HeldKickoffOptions {
  /** When false the hook makes no request and reports `{ held: false }`, `ready`. Default true. */
  enabled?: boolean;
  /** Keep polling every 5s even while not held, so a hold restored after a failed start is seen. Default false. */
  pollAlways?: boolean;
}

export class HeldKickoffConflictError extends Error {}

/** null when the lookup failed: a non-OK response, a non-JSON body or a rejected fetch. */
async function fetchHeldKickoff(name: string, signal?: AbortSignal): Promise<HeldKickoff | null> {
  try {
    const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(name)}/kickoff`, { signal });
    if (!res.ok) return null;
    // .clone() so reading this body never consumes a Response another fetch
    // consumer (e.g. a test's blanket fetch mock shared across endpoints) still
    // needs to read.
    return (await res.clone().json()) as HeldKickoff;
  } catch {
    return null;
  }
}

interface HeldKickoffSnapshot extends HeldKickoff {
  /** The conversation + enabled pair this answer belongs to; a stale key reads as `loading`. */
  key: string;
  status: HeldKickoffStatus;
}

/** Polls the kickoff door every 5s while held (or always, with `pollAlways`); stops once the conversation starts. */
export function useHeldKickoff(
  conversationName: string,
  options: HeldKickoffOptions = {},
): HeldKickoff & { status: HeldKickoffStatus; refresh: () => void } {
  const enabled = options.enabled ?? true;
  const pollAlways = options.pollAlways ?? false;
  const key = `${conversationName}::${enabled}`;
  const [snapshot, setSnapshot] = useState<HeldKickoffSnapshot | null>(null);
  const heldRef = useRef(false);
  const succeededKeyRef = useRef<string | null>(null);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    heldRef.current = false;
    if (!enabled) {
      loadRef.current = () => {};
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const load = () => {
      void fetchHeldKickoff(conversationName, controller.signal).then((next) => {
        if (cancelled) return;
        if (next) {
          succeededKeyRef.current = key;
          heldRef.current = next.held;
          setSnapshot({ ...next, key, status: 'ready' });
        } else if (succeededKeyRef.current !== key) {
          setSnapshot({ held: false, key, status: 'error' });
        }
        // A failure after a success keeps the last known state.
      });
    };
    loadRef.current = () => {
      setSnapshot((prev) => (prev?.key === key && prev.status === 'error' ? { ...prev, status: 'loading' } : prev));
      load();
    };
    load();
    const interval = setInterval(() => { if (heldRef.current || pollAlways) load(); }, 5000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [conversationName, enabled, key, pollAlways]);

  // Stable identity: `heldKickoff` sits in ComposerFooter's handleSubmit
  // useCallback deps, and a fresh object/function every render there would
  // recreate handleSubmit (and everything downstream of it) on every render.
  const refresh = useCallback(() => loadRef.current(), []);
  return useMemo(() => {
    if (!enabled) return { held: false, status: 'ready' as const, refresh };
    // An answer for another conversation never shows through a switch.
    if (!snapshot || snapshot.key !== key) return { held: false, status: 'loading' as const, refresh };
    return { held: snapshot.held, text: snapshot.text, focus: snapshot.focus, status: snapshot.status, refresh };
  }, [enabled, key, snapshot, refresh]);
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
