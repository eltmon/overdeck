export type AutoPresoMode = 'staging' | 'live';
export type WarmupStatus = 'idle' | 'warming' | 'ready' | 'failed';
export type ExcalidrawElementLike = Record<string, unknown>;

interface AutoPresoSnapshot {
  mode: AutoPresoMode;
  warmupStatus: WarmupStatus;
  elements: readonly ExcalidrawElementLike[];
}

type AutoPresoListener = (snapshot: AutoPresoSnapshot) => void;

export interface AutoPresoSession {
  snapshot(): AutoPresoSnapshot;
  start(elements: readonly ExcalidrawElementLike[]): AutoPresoSnapshot;
  backToStaging(): AutoPresoSnapshot;
  reset(): AutoPresoSnapshot;
  subscribe(listener: AutoPresoListener): () => void;
}

export function createAutoPresoSession(): AutoPresoSession {
  let mode: AutoPresoMode = 'staging';
  let warmupStatus: WarmupStatus = 'idle';
  let elements: readonly ExcalidrawElementLike[] = [];
  const listeners = new Set<AutoPresoListener>();

  const snapshot = (): AutoPresoSnapshot => ({ mode, warmupStatus, elements });
  const notify = () => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
    return current;
  };

  return {
    snapshot,
    start(nextElements) {
      mode = 'live';
      warmupStatus = 'ready';
      elements = nextElements;
      return notify();
    },
    backToStaging() {
      mode = 'staging';
      warmupStatus = 'idle';
      return notify();
    },
    reset() {
      mode = 'staging';
      warmupStatus = 'idle';
      elements = [];
      return notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const autoPresoSession = createAutoPresoSession();
