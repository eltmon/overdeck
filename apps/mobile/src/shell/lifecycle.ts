/**
 * The foreground resume path (PAN-4837 FR-13, epic CP-3). When the app returns to the foreground
 * the directory socket restarts (its back-off resets), every peer connection is dropped and the
 * remembered routes forgotten, and the RPC transport resets, so fresh data arrives without waiting
 * out a dead socket. `resumedAt` drives the "Updating…" banner.
 */
import { App } from '@capacitor/app';
import { useSyncExternalStore } from 'react';

import type { Connection } from './connection';

export const RESUME_BANNER_WINDOW_MS = 30_000;

export interface ResumeTargets {
  directory: { stop(): void; start(): Promise<void> } | null;
  connection: Pick<Connection, 'forgetRoutes'> | null;
  resetTransport(): void;
}

let resumedAt: number | null = null;
const listeners = new Set<() => void>();

export function markResumed(at = Date.now()): void {
  resumedAt = at;
  for (const listener of [...listeners]) listener();
}

export function useResumedAt(): number | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => resumedAt,
  );
}

/** Restart every connection the shell holds. */
export function resume(targets: ResumeTargets): void {
  if (targets.directory) {
    targets.directory.stop();
    void targets.directory.start();
  }
  targets.connection?.forgetRoutes();
  targets.resetTransport();
  markResumed();
}

/** Run {@link resume} each time the app becomes active; returns the uninstaller. */
export function installResumeHandler(targets: () => ResumeTargets, app: Pick<typeof App, 'addListener'> = App): () => void {
  const handle = app.addListener('appStateChange', ({ isActive }) => {
    if (isActive) resume(targets());
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}
