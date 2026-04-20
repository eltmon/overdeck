/**
 * PtyHub — manages shared PTY processes with multiple WebSocket clients.
 *
 * One PTY per tmux session; multiple browser tabs (WebSocket clients) attach
 * to the same PTY. Output is broadcast to all clients; any client can write input.
 * The PTY stays alive until the last client disconnects.
 *
 * Extracted from ws-terminal.ts for testability (PAN-484).
 */

import { WebSocket } from 'ws';
import type * as pty from '@homebridge/node-pty-prebuilt-multiarch';

/** A shared PTY hub: one PTY process serving multiple WebSocket clients. */
export interface PtyHub {
  pty: pty.IPty;
  clients: Set<WebSocket>;
  /** Current PTY dimensions — set by first client, updated by any resize event. */
  cols: number;
  rows: number;
  /**
   * The client whose keystrokes are forwarded to the PTY.
   * Always the most recently connected client. When it disconnects, falls back
   * to another remaining client. This prevents double-echo when multiple browser
   * tabs have the same terminal open.
   */
  inputClient: WebSocket | null;
  /** Per-client bootstrap state used to gate live PTY output until the client is ready. */
  clientStates: Map<WebSocket, { ready: boolean; pending: string[] }>;
}

/** Shared registry of active PTY hubs, keyed by tmux session name. */
export const activePtyHubs = new Map<string, PtyHub>();

/**
 * Broadcast data to all open clients in the hub. Clients that are still booting
 * buffer live PTY output until they acknowledge their snapshot.
 */
export function broadcastToHub(hub: PtyHub, data: string): void {
  for (const client of hub.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const state = hub.clientStates.get(client);
    if (state && !state.ready) {
      state.pending.push(data);
      continue;
    }
    client.send(data);
  }
}

export function setClientReady(hub: PtyHub, ws: WebSocket): void {
  const state = hub.clientStates.get(ws);
  if (!state || state.ready || ws.readyState !== WebSocket.OPEN) return;
  state.ready = true;
  for (const chunk of state.pending) {
    ws.send(chunk);
  }
  state.pending.length = 0;
}

export function addClientToHub(hub: PtyHub, ws: WebSocket, ready: boolean): void {
  hub.clients.add(ws);
  hub.clientStates.set(ws, { ready, pending: [] });
}

/**
 * Remove a client from its hub. If it was the last client, delete the hub entry
 * and let the PTY exit naturally (pipes close).
 *
 * If the removed client was the inputClient, assigns a new inputClient from
 * the remaining clients so keystrokes keep working.
 *
 * Returns true if the hub was torn down (last client removed).
 */
export function removeClientFromHub(
  hubs: Map<string, PtyHub>,
  sessionName: string,
  ws: WebSocket,
): boolean {
  const hub = hubs.get(sessionName);
  if (!hub) return false;
  hub.clients.delete(ws);
  hub.clientStates.delete(ws);
  if (hub.clients.size === 0) {
    hubs.delete(sessionName);
    // Kill the PTY (our `tmux attach-session` process) so it stops being
    // a tmux client. Previously we let the PTY "exit naturally when pipes
    // close", but `tmux attach-session` doesn't exit when its stdout/stdin
    // go quiet — it stays attached to tmux forever. Every dashboard
    // restart then left behind an orphan tmux client whose dimensions
    // pinned the window size and caused the "dots on the right" snapshot
    // glitch (Claude Code truncating to the smaller window, dashboards
    // displaying at the larger client dims).
    try {
      hub.pty.kill();
    } catch {
      // PTY may already have exited; nothing to do.
    }
    return true; // last client — hub torn down
  }
  // If the departing client was the input client, hand off to another
  if (hub.inputClient === ws) {
    hub.inputClient = hub.clients.values().next().value ?? null;
  }
  return false;
}
