/**
 * Starting a PTY hub's `tmux attach-session` process and wiring it to the hub.
 *
 * Split from ws-terminal.ts (PAN-4477) so both `/ws/terminal` and the Shared
 * Sessions terminal bridge can start a hub the same way. pty-hub.ts keeps a
 * type-only import of node-pty; this module loads it at runtime.
 *
 * subscribeToTmuxHub is the bridge's read-only tmux source: a hub listener
 * that never writes to or resizes the PTY. When no tab has the session open it
 * starts a hub at the window's client size, so watching does not resize the
 * host window.
 */

import { homedir } from 'node:os';
import { WebSocket } from 'ws';
import { Effect } from 'effect';
import * as pty from '@lydell/node-pty';
import {
  activePtyHubs,
  addHubListener,
  broadcastToHub,
  notifyHubExit,
  removeHubListener,
  type PtyHub,
  type PtyHubListener,
} from './pty-hub.js';
import { buildTmuxArgs, capturePane, sessionExists, tmuxExecAsync } from '../../lib/tmux.js';
import { buildChildEnvWithoutTmux } from '../../lib/child-env.js';
import type { TerminalFrame } from '../../lib/terminal-backends/types.js';

/** `tmux attach-session` in a PTY, with TMUX/TMUX_PANE stripped (moved from ws-terminal.ts). */
export function spawnTmuxAttachPty(sessionName: string, cols: number, rows: number): pty.IPty {
  // Strip TMUX/TMUX_PANE from inherited env so `tmux attach-session` doesn't refuse
  // with "sessions should be nested with care, unset $TMUX to force" when the
  // dashboard server itself was launched from inside a tmux pane.
  return pty.spawn('tmux', buildTmuxArgs(['attach-session', '-t', sessionName]), {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: homedir(),
    env: buildChildEnvWithoutTmux(process.env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8',
    }) as { [key: string]: string },
  });
}

/**
 * Wires a hub's PTY: output → broadcastToHub; exit → delete the registry entry (only if it still
 * points at this hub), close every OPEN client with 1000 'Session ended', clear clients and states,
 * notifyHubExit(hub). Sets hub.pty.
 */
export function attachHubPty(
  hubs: Map<string, PtyHub>,
  sessionName: string,
  hub: PtyHub,
  ptyProcess: pty.IPty,
): void {
  hub.pty = ptyProcess;

  ptyProcess.onData((data) => {
    broadcastToHub(hub, data);
  });

  ptyProcess.onExit(() => {
    if (hubs.get(sessionName) === hub) hubs.delete(sessionName);
    for (const client of hub.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, 'Session ended');
      }
    }
    hub.clients.clear();
    hub.clientStates.clear();
    notifyHubExit(hub);
  });
}

export interface TmuxHubDeps {
  readonly hubs: Map<string, PtyHub>;
  sessionExists(sessionName: string): Promise<boolean>;
  /** Window width and height + status lines, from `display-message -p '#{window_width},#{window_height},#{status}'`. */
  clientSize(sessionName: string): Promise<{ cols: number; rows: number } | null>;
  /** Visible-pane capture with escape sequences: capturePane(sessionName, 0, { escapeSequences: true }). */
  captureViewport(sessionName: string): Promise<string>;
  spawn(sessionName: string, cols: number, rows: number): pty.IPty;
}

/**
 * Parses `#{window_width},#{window_height},#{status}` into the size a tmux client needs so the
 * window keeps its size: status `off` adds no row, `on` adds one, a digit `n` adds `n`.
 */
export function parseTmuxClientSize(output: string): { cols: number; rows: number } | null {
  const parts = output.trim().split(',');
  if (parts.length !== 3) return null;
  const cols = Number.parseInt(parts[0]!, 10);
  const rows = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
  const status = parts[2]!;
  let statusLines: number;
  if (status === 'off') statusLines = 0;
  else if (status === 'on') statusLines = 1;
  else if (/^\d$/.test(status)) statusLines = Number(status);
  else return null;
  return { cols, rows: rows + statusLines };
}

export const productionTmuxHubDeps: TmuxHubDeps = {
  hubs: activePtyHubs,
  sessionExists: (sessionName) => Effect.runPromise(sessionExists(sessionName)).catch(() => false),
  clientSize: async (sessionName) => {
    try {
      const { stdout } = await tmuxExecAsync(
        ['display-message', '-p', '-t', sessionName, '#{window_width},#{window_height},#{status}'],
        { encoding: 'utf-8' },
      );
      return parseTmuxClientSize(String(stdout));
    } catch {
      return null;
    }
  },
  captureViewport: (sessionName) => capturePane(sessionName, 0, { escapeSequences: true }),
  spawn: spawnTmuxAttachPty,
};

/**
 * `capture-pane -p` ends every line with a bare LF. A terminal without convertEol moves down a row
 * but keeps the column, so each line would start where the last one ended: use CRLF instead, and
 * drop the final line's LF so a full screen does not scroll its top row away.
 */
export function snapshotLines(capture: string): string {
  return capture.replace(/\r?\n$/, '').replace(/\r?\n/g, '\r\n');
}

/** Streams a tmux session's hub as TerminalFrames; null when the session does not exist. The subscription has no write method. */
export async function subscribeToTmuxHub(
  sessionName: string,
  onFrame: (frame: TerminalFrame) => void,
  deps: TmuxHubDeps = productionTmuxHubDeps,
): Promise<{ close(): void } | null> {
  let hub = deps.hubs.get(sessionName);
  if (!hub) {
    if (!(await deps.sessionExists(sessionName))) return null;
    const size = await deps.clientSize(sessionName);
    if (!size) return null;
    // ws-terminal may have created a hub while we waited.
    hub = deps.hubs.get(sessionName);
    if (!hub) {
      let ptyProcess: pty.IPty;
      try {
        ptyProcess = deps.spawn(sessionName, size.cols, size.rows);
      } catch {
        return null;
      }
      hub = {
        pty: null,
        clients: new Set(),
        cols: size.cols,
        rows: size.rows,
        pendingInput: [],
        inputClient: null,
        clientStates: new Map(),
      };
      deps.hubs.set(sessionName, hub);
      attachHubPty(deps.hubs, sessionName, hub, ptyProcess);
    }
  }
  const subscribedHub = hub;

  // `closed`: no more frames. `released`: the listener is gone from the hub (by close or by PTY exit,
  // which forgets every listener), so close() never tears down a hub whose PTY already exited.
  let closed = false;
  let released = false;
  let snapshotSent = false;
  const pending: string[] = [];

  const listener: PtyHubListener = {
    onData(data) {
      if (closed) return;
      if (snapshotSent) onFrame({ kind: 'output', data });
      else pending.push(data);
    },
    onSize(cols, rows) {
      // Before the snapshot, the snapshot itself carries the hub's current size.
      if (closed || !snapshotSent) return;
      onFrame({ kind: 'size', cols, rows });
    },
    onExit() {
      released = true;
      if (closed) return;
      closed = true;
      onFrame({ kind: 'exit', code: null });
    },
  };
  // Listen before capturing so no output between the capture and the first live chunk is lost.
  addHubListener(subscribedHub, listener);

  const subscription = {
    close() {
      closed = true;
      if (released) return;
      released = true;
      removeHubListener(deps.hubs, sessionName, subscribedHub, listener);
    },
  };

  const data = snapshotLines(await deps.captureViewport(sessionName).catch(() => ''));
  if (closed) return subscription;
  snapshotSent = true;
  onFrame({ kind: 'snapshot', cols: subscribedHub.cols, rows: subscribedHub.rows, data });
  if (pending.length > 0) {
    onFrame({ kind: 'output', data: pending.join('') });
    pending.length = 0;
  }
  return subscription;
}
