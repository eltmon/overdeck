/**
 * Starting a PTY hub's `tmux attach-session` process and wiring it to the hub.
 *
 * Split from ws-terminal.ts (PAN-4477) so both `/ws/terminal` and the Shared
 * Sessions terminal bridge can start a hub the same way. pty-hub.ts keeps a
 * type-only import of node-pty; this module loads it at runtime.
 */

import { homedir } from 'node:os';
import { WebSocket } from 'ws';
import * as pty from '@lydell/node-pty';
import { broadcastToHub, notifyHubExit, type PtyHub } from './pty-hub.js';
import { buildTmuxArgs } from '../../lib/tmux.js';
import { buildChildEnvWithoutTmux } from '../../lib/child-env.js';

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
