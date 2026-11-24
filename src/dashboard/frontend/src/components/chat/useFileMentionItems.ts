/**
 * The composer's @ menu rows (PAN-5662): a debounced `pan.explorerSearchFiles`
 * lookup over the conversation's explorer root. No new server route; the
 * explorer's own file search ranks the paths. A closed menu, a missing root
 * or an empty filter makes no request; an answer to a stale query is dropped,
 * and no rows show while a search is in flight.
 */
import { useEffect, useRef, useState } from 'react';
import { searchFiles } from '../explorer/explorer-rpc';
import { toFileMentionItems } from './composerTriggers';
import type { SlashCommand } from './slashCommandTypes';

export const FILE_MENTION_DEBOUNCE_MS = 120;
export const FILE_MENTION_LIMIT = 20;

const NO_ITEMS = Object.freeze([]) as unknown as SlashCommand[];

export function useFileMentionItems(rootId: string | null, filter: string | null): { items: SlashCommand[] } {
  // Rows are stored with the query they answer, so rows for an earlier query
  // never show while a newer one is in flight.
  const [answer, setAnswer] = useState<{ query: string; items: SlashCommand[] } | null>(null);
  const sequenceRef = useRef(0);
  const warnedRef = useRef(false);
  const query = rootId === null || filter === null || filter === '' ? null : `${rootId}\u0000${filter}`;

  useEffect(() => {
    // Any change invalidates an in-flight answer.
    const sequence = ++sequenceRef.current;
    if (query === null || rootId === null || filter === null) return;

    const timer = setTimeout(() => {
      searchFiles(rootId, filter, FILE_MENTION_LIMIT)
        .then((result) => {
          if (sequence === sequenceRef.current) setAnswer({ query, items: toFileMentionItems(result.paths) });
        })
        .catch((error: unknown) => {
          if (sequence !== sequenceRef.current) return;
          setAnswer({ query, items: NO_ITEMS });
          if (warnedRef.current) return;
          warnedRef.current = true;
          console.warn('[fileMentions] search failed:', error);
        });
    }, FILE_MENTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      // Rows answer one search; a closed menu or another query drops them, so
      // reopening on the same query shows nothing until a fresh answer lands.
      setAnswer(null);
    };
  }, [query, rootId, filter]);

  // Unmount: drop any answer still in flight.
  useEffect(() => () => { sequenceRef.current += 1; }, []);

  return { items: query !== null && answer?.query === query ? answer.items : NO_ITEMS };
}
