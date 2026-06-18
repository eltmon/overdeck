/**
 * useFilePathExists (PAN-1457)
 *
 * Hook that resolves whether a path-like token exists on disk under cwd.
 * Used by ChatMarkdown to gate MarkdownFileLink chip rendering — phantom
 * paths like `conv/2209` resolve to missing and render as plain text,
 * while real files and directories (including bare directory references
 * without file extensions) render as chips.
 *
 * Cache: see filePathExistsCache. Inflight requests are deduplicated by
 * (cwd, path) so a single render pass over a transcript that references
 * `src/App.tsx` 30 times triggers one RPC, not 30.
 */

import { useEffect, useState } from 'react';
import { WS_METHODS } from '@overdeck/contracts';
import { getTransport, type PanRpcProtocolClient } from '../lib/wsTransport';
import {
  getCachedExists,
  setCachedExists,
  type FilePathExistsKind,
} from '../lib/filePathExistsCache';

export type FilePathExistsState =
  | { state: 'loading' }
  | { state: 'exists'; kind: FilePathExistsKind }
  | { state: 'missing' };

const inflight = new Map<string, Promise<{ exists: boolean; kind: FilePathExistsKind }>>();

function inflightKey(cwd: string, path: string): string {
  return `${cwd}\0${path}`;
}

function readCacheState(cwd: string | undefined, path: string | undefined): FilePathExistsState {
  if (!cwd || !path) return { state: 'missing' };
  const cached = getCachedExists(cwd, path);
  if (!cached) return { state: 'loading' };
  return cached.exists
    ? { state: 'exists', kind: cached.kind }
    : { state: 'missing' };
}

export function useFilePathExists(
  cwd: string | undefined,
  path: string | undefined,
): FilePathExistsState {
  const [state, setState] = useState<FilePathExistsState>(() => readCacheState(cwd, path));

  useEffect(() => {
    if (!cwd || !path) {
      setState({ state: 'missing' });
      return;
    }

    const cached = getCachedExists(cwd, path);
    if (cached) {
      setState(
        cached.exists
          ? { state: 'exists', kind: cached.kind }
          : { state: 'missing' },
      );
      return;
    }

    setState({ state: 'loading' });
    let cancelled = false;
    const key = inflightKey(cwd, path);

    let promise = inflight.get(key);
    if (!promise) {
      promise = getTransport()
        .request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.resolveFilePathExists]({ cwd, path }),
        )
        .then((result) => ({
          exists: result.exists,
          kind: result.kind as FilePathExistsKind,
        }))
        .catch(() => ({ exists: false as const, kind: null as FilePathExistsKind }));
      inflight.set(key, promise);
      void promise.finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
    }

    void promise.then((result) => {
      setCachedExists(cwd, path, result.exists, result.kind);
      if (cancelled) return;
      setState(
        result.exists
          ? { state: 'exists', kind: result.kind }
          : { state: 'missing' },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [cwd, path]);

  return state;
}
