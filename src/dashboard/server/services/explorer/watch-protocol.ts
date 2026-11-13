/**
 * Explorer watcher IPC protocol (PAN-5183, D-5). Message types between the
 * dashboard's watch supervisor and the forked `explorer-watch-child.js`.
 * Both sides import this file; it holds no runtime code except the exit
 * code constant, so it pulls nothing into either bundle.
 */
import type { ExplorerWatchEvent } from '@overdeck/contracts';

export type SupervisorToChild =
  | { type: 'watch'; rootId: string; absPath: string; topLevelDirs: string[] }
  | { type: 'unwatch'; rootId: string };

export type ChildToSupervisor =
  | { type: 'events'; rootId: string; events: ExplorerWatchEvent[] }
  | { type: 'heartbeat' }
  | { type: 'watch-failed'; rootId: string; message: string }
  | { type: 'error'; rootId: string; message: string };

/** The child exits with this code when a parcel backend reports an error. */
export const WATCH_CHILD_BACKEND_DEATH_EXIT = 3;
