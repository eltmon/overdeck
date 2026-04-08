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
  /**
   * Per-client blackout map: clients in their blackout period receive no data.
   * Prevents scrollback flooding when a browser tab reconnects to an existing hub.
   * Cleared 200ms after the client joins (after the SIGWINCH repaint fires).
   */
  clientBlackout: Map<WebSocket, number>;
}

/** Shared registry of active PTY hubs, keyed by tmux session name. */
export const activePtyHubs = new Map<string, PtyHub>();

/**
 * Broadcast data to all open clients in the hub, respecting per-client blackout periods.
 * Clients that are still within their 200ms blackout window receive nothing — this
 * prevents scrollback flooding when a browser tab reconnects to an existing hub.
 */
export function broadcastToHub(hub: PtyHub, data: string): void {
  const now = Date.now();
  for (const client of hub.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const blackoutUntil = hub.clientBlackout.get(client);
    if (blackoutUntil && now < blackoutUntil) continue;
    client.send(data);
  }
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
  hub.clientBlackout.delete(ws);
  if (hub.clients.size === 0) {
    hubs.delete(sessionName);
    return true; // last client — hub torn down
  }
  // If the departing client was the input client, hand off to another
  if (hub.inputClient === ws) {
    hub.inputClient = hub.clients.values().next().value ?? null;
  }
  return false;
}
