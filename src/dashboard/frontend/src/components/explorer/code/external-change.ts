// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/hooks/editor-external-watch-event-reconciliation.ts @ 73771e67d01
/**
 * External-change controller for one code pane (PAN-5187, FR-8).
 *
 * Turns watcher events for the pane's file into a reload or a state the
 * banner shows. Only Orca's decision logic is ported; its store wiring,
 * multi-workspace fan-out and path indexing are not.
 *
 * Rules:
 * - An overflow event (D-C21), or a create/update/rename-onto of the
 *   pane's path, re-reads the file 250 ms after the last such event.
 * - A re-read waits for a save in flight to settle first (D-C18), and is
 *   repeated if a save starts or the base moves while it runs.
 * - After a re-read: missing → deleted; the base signature or a recent
 *   self-write signature → nothing (a stale mark is cleared); a clean pane
 *   reloads; a dirty pane is marked changed.
 * - A delete of the path opens a 500 ms window (D-C20). A create of the
 *   same path in it is an atomic save by another editor: it re-reads. A
 *   create of another path with the same basename marks the pane renamed.
 *   Deletes in a batch are handled first, since a move may list its create
 *   before its delete.
 *   When the window closes the file is re-read: still missing → deleted.
 * - A rename event whose oldPath is the pane's path marks it renamed.
 */
import type { ExplorerWatchEvent } from '@overdeck/contracts';

export const REREAD_DELAY_MS = 250;
export const DELETE_WINDOW_MS = 500;

export type ExternalChangeState =
  | { kind: 'clean' }
  | { kind: 'changed'; diskText: string; diskSignature: string }
  | { kind: 'deleted' }
  | { kind: 'renamed'; newPath: string };

export type DiskRead = { missing: true } | { missing: false; text: string; signature: string };

export interface ExternalChangeDeps {
  getPath(): string;
  getBaseSignature(): string | null;
  isDirty(): boolean;
  isSaveInFlight(): boolean;
  whenSaveIdle(): Promise<void>;
  reread(): Promise<DiskRead>;
  isSelfWrite(signature: string): boolean;
  reload(read: { text: string; signature: string }): void;
  setState(state: ExternalChangeState): void;
}

export interface ExternalChangeController {
  handle(events: readonly ExplorerWatchEvent[]): void;
  /** Record a state the pane set itself (a banner action, a DISK_CONFLICT answer). */
  noteState(state: ExternalChangeState): void;
  dispose(): void;
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export function createExternalChangeController(deps: ExternalChangeDeps): ExternalChangeController {
  let current: ExternalChangeState['kind'] = 'clean';
  let rereadTimer: ReturnType<typeof setTimeout> | null = null;
  let deleteTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const setState = (state: ExternalChangeState) => {
    current = state.kind;
    deps.setState(state);
  };

  const clearMark = () => {
    if (current !== 'clean') setState({ kind: 'clean' });
  };

  const apply = (read: DiskRead) => {
    if (read.missing) {
      setState({ kind: 'deleted' });
      return;
    }
    if (read.signature === deps.getBaseSignature() || deps.isSelfWrite(read.signature)) {
      clearMark();
      return;
    }
    if (!deps.isDirty()) {
      deps.reload({ text: read.text, signature: read.signature });
      clearMark();
      return;
    }
    setState({ kind: 'changed', diskText: read.text, diskSignature: read.signature });
  };

  const readNow = async () => {
    // A save that starts during the read can land on disk first, and one
    // that finishes during it moves the base: either way the read cannot be
    // judged against the current base, so read again once the save settles.
    for (;;) {
      if (deps.isSaveInFlight()) await deps.whenSaveIdle();
      if (disposed) return;
      const baseBefore = deps.getBaseSignature();
      let read: DiskRead;
      try {
        read = await deps.reread();
      } catch (error) {
        console.warn('[explorer-code] re-read after an external change failed', error);
        return;
      }
      if (disposed) return;
      if (!deps.isSaveInFlight() && deps.getBaseSignature() === baseBefore) {
        apply(read);
        return;
      }
    }
  };

  const scheduleReread = () => {
    if (rereadTimer !== null) clearTimeout(rereadTimer);
    rereadTimer = setTimeout(() => {
      rereadTimer = null;
      void readNow();
    }, REREAD_DELAY_MS);
  };

  const cancelDeleteWindow = (): boolean => {
    if (deleteTimer === null) return false;
    clearTimeout(deleteTimer);
    deleteTimer = null;
    return true;
  };

  const openDeleteWindow = () => {
    cancelDeleteWindow();
    deleteTimer = setTimeout(() => {
      deleteTimer = null;
      void readNow();
    }, DELETE_WINDOW_MS);
  };

  const handleOne = (event: ExplorerWatchEvent, path: string) => {
    switch (event.kind) {
      case 'overflow':
        scheduleReread();
        return;
      case 'rename':
        if (event.oldPath === path) {
          cancelDeleteWindow();
          setState({ kind: 'renamed', newPath: event.path });
        } else if (event.path === path) {
          cancelDeleteWindow();
          scheduleReread();
        }
        return;
      case 'delete':
        if (event.path === path) openDeleteWindow();
        return;
      case 'create':
      case 'update':
        if (event.path === path) {
          cancelDeleteWindow();
          scheduleReread();
        } else if (
          event.kind === 'create' &&
          event.isDirectory !== true &&
          deleteTimer !== null &&
          basename(event.path) === basename(path)
        ) {
          cancelDeleteWindow();
          setState({ kind: 'renamed', newPath: event.path });
        }
        return;
    }
  };

  return {
    handle(events) {
      if (disposed) return;
      const path = deps.getPath();
      // Deletes first: a move can list the create before the delete in one
      // batch. The watcher already drops a create then delete of one path
      // within a batch, so this never reorders an atomic save.
      for (const event of events) if (event.kind === 'delete') handleOne(event, path);
      for (const event of events) if (event.kind !== 'delete') handleOne(event, path);
    },
    noteState(state) {
      current = state.kind;
    },
    dispose() {
      disposed = true;
      if (rereadTimer !== null) clearTimeout(rereadTimer);
      rereadTimer = null;
      cancelDeleteWindow();
    },
  };
}
