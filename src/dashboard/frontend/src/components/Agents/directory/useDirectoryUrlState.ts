/**
 * Agents Directory selection mirrored in the URL (PAN-3920 W6, FR-6):
 * `/agents?node=<nodeId>&entry=<entryId>&window=24|168`, written with
 * `history.replaceState` so selection never grows the back stack. Other query
 * params (`view`, filters) are preserved.
 */
import { useCallback, useEffect, useState } from 'react';

import type { DirectoryWindowHours } from './useAgentDirectory';

export interface DirectoryUrlState {
  nodeId: string | null;
  entryId: string | null;
  windowHours: DirectoryWindowHours;
}

function readState(): DirectoryUrlState {
  if (typeof window === 'undefined') return { nodeId: null, entryId: null, windowHours: 24 };
  const params = new URLSearchParams(window.location.search);
  return {
    nodeId: params.get('node'),
    entryId: params.get('entry'),
    windowHours: params.get('window') === '168' ? 168 : 24,
  };
}

function writeState(state: DirectoryUrlState): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const set = (key: string, value: string | null) => {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };
  set('node', state.nodeId);
  set('entry', state.entryId);
  set('window', state.windowHours === 168 ? '168' : null);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useDirectoryUrlState() {
  const [state, setState] = useState<DirectoryUrlState>(readState);

  useEffect(() => {
    const onPopState = () => setState(readState());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const update = useCallback((patch: Partial<DirectoryUrlState>) => {
    setState((previous) => {
      const next = { ...previous, ...patch };
      writeState(next);
      return next;
    });
  }, []);

  return {
    ...state,
    setNode: useCallback((nodeId: string) => update({ nodeId, entryId: null }), [update]),
    setEntry: useCallback((entryId: string) => update({ entryId }), [update]),
    setWindow: useCallback((windowHours: DirectoryWindowHours) => update({ windowHours }), [update]),
  };
}
