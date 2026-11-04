/**
 * PtyHub — manages shared PTY processes with multiple WebSocket clients.
 *
 * One PTY per tmux session; multiple browser tabs (WebSocket clients) attach
 * to the same PTY. Output is broadcast to all clients; any client can write input.
 * Listeners (PtyHubListener, e.g. the Shared Sessions terminal bridge, PAN-4477)
 * also receive the output, but they never write. The PTY stays alive until the
 * last client and the last listener are gone.
 *
 * Extracted from ws-terminal.ts for testability (PAN-484).
 */

import { WebSocket } from 'ws';
import type * as pty from '@lydell/node-pty';

/** A shared PTY hub: one PTY process serving multiple WebSocket clients. */
export interface PtyHub {
  pty: pty.IPty | null;
  clients: Set<WebSocket>;
  /** Current PTY dimensions — set by first client, updated by any resize event. */
  cols: number;
  rows: number;
  pendingInput: string[];
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
 *
 * Output coalescing: PTY data arrives as many small chunks (one per read
 * syscall). Instead of sending each as a separate WebSocket frame — which
 * creates per-message overhead on the client (event dispatch, type checks,
 * xterm.js write call) — we buffer chunks for up to 4ms and flush them as
 * one combined message. This cuts WebSocket frame count by 5-50x during
 * burst output (Claude Code TUI redraws) without adding perceptible latency.
 */
const MAX_PENDING_CHUNKS = 5000;
const COALESCE_MS = 4;

const hubOutputBuffer = new Map<PtyHub, string[]>();
const hubFlushTimer = new Map<PtyHub, ReturnType<typeof setTimeout>>();

/** A non-WebSocket consumer of a hub's output (Shared Sessions terminal bridge, PAN-4477). It never writes. */
export interface PtyHubListener {
  onData(data: string): void;
  onSize(cols: number, rows: number): void;
  onExit(): void;
}

// Kept outside PtyHub so hub literals need no listener field.
const hubListeners = new Map<PtyHub, Set<PtyHubListener>>();

function flushHubOutput(hub: PtyHub): void {
  hubFlushTimer.delete(hub);
  const chunks = hubOutputBuffer.get(hub);
  hubOutputBuffer.delete(hub);
  if (!chunks || chunks.length === 0) return;
  const combined = chunks.join('');

  for (const client of hub.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const state = hub.clientStates.get(client);
    if (state && !state.ready) {
      if (state.pending.length >= MAX_PENDING_CHUNKS) {
        state.pending.splice(0, state.pending.length - MAX_PENDING_CHUNKS + 1);
      }
      state.pending.push(combined);
      continue;
    }
    client.send(combined);
  }

  const listeners = hubListeners.get(hub);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener.onData(combined);
    } catch {
      listeners.delete(listener);
    }
  }
}

export function broadcastToHub(hub: PtyHub, data: string): void {
  let buffer = hubOutputBuffer.get(hub);
  if (!buffer) {
    buffer = [];
    hubOutputBuffer.set(hub, buffer);
  }
  buffer.push(data);

  if (!hubFlushTimer.has(hub)) {
    hubFlushTimer.set(hub, setTimeout(() => flushHubOutput(hub), COALESCE_MS));
  }
}

export function setClientReady(hub: PtyHub, ws: WebSocket): void {
  const state = hub.clientStates.get(ws);
  if (!state || state.ready || ws.readyState !== WebSocket.OPEN) return;
  state.ready = true;
  if (state.pending.length > 0) {
    ws.send(state.pending.join(''));
    state.pending.length = 0;
  }
}

export function addClientToHub(hub: PtyHub, ws: WebSocket, ready: boolean): void {
  hub.clients.add(ws);
  hub.clientStates.set(ws, { ready, pending: [] });
}

/**
 * Remove a client from its hub. If it was the last client and the hub has no
 * listener, tear the hub down (see teardownHub).
 *
 * If the removed client was the inputClient, assigns a new inputClient from
 * the remaining clients so keystrokes keep working.
 *
 * Returns true if the hub was torn down.
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
  if (hub.clients.size === 0 && (hubListeners.get(hub)?.size ?? 0) === 0) {
    teardownHub(hubs, sessionName, hub);
    return true;
  }
  // If the departing client was the input client, hand off to another
  if (hub.inputClient === ws) {
    hub.inputClient = hub.clients.values().next().value ?? null;
  }
  return false;
}

export function addHubListener(hub: PtyHub, listener: PtyHubListener): void {
  let listeners = hubListeners.get(hub);
  if (!listeners) {
    listeners = new Set();
    hubListeners.set(hub, listeners);
  }
  listeners.add(listener);
}

/**
 * Removes a listener from THIS hub (the caller passes the hub object it subscribed to, never a fresh
 * registry lookup: the session may have a newer hub by now). Tears the hub down (kills its PTY, clears
 * its buffers) when it has no client and no listener; deletes the registry entry only if it still
 * points at this hub. Returns true on teardown.
 */
export function removeHubListener(
  hubs: Map<string, PtyHub>,
  sessionName: string,
  hub: PtyHub,
  listener: PtyHubListener,
): boolean {
  const listeners = hubListeners.get(hub);
  listeners?.delete(listener);
  if (hub.clients.size === 0 && (listeners?.size ?? 0) === 0) {
    teardownHub(hubs, sessionName, hub);
    return true;
  }
  return false;
}

/** Tells every listener the hub's current `cols`/`rows`. */
export function notifyHubSize(hub: PtyHub): void {
  const listeners = hubListeners.get(hub);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener.onSize(hub.cols, hub.rows);
    } catch {
      listeners.delete(listener);
    }
  }
}

/** Tells every listener the PTY exited, then forgets them. */
export function notifyHubExit(hub: PtyHub): void {
  const listeners = hubListeners.get(hub);
  // Forget first: an onExit may call removeHubListener on this hub.
  hubListeners.delete(hub);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener.onExit();
    } catch {
      // A failing listener must not stop the others.
    }
  }
}

/**
 * Unregister a hub (only if the registry still points at it: a stale hub must
 * never unregister its successor), drop its buffers and listeners, and kill its PTY.
 */
function teardownHub(hubs: Map<string, PtyHub>, sessionName: string, hub: PtyHub): void {
  if (hubs.get(sessionName) === hub) hubs.delete(sessionName);
  const timer = hubFlushTimer.get(hub);
  if (timer) { clearTimeout(timer); hubFlushTimer.delete(hub); }
  hubOutputBuffer.delete(hub);
  hubListeners.delete(hub);
  // Kill the PTY (our `tmux attach-session` process) so it stops being
  // a tmux client. Previously we let the PTY "exit naturally when pipes
  // close", but `tmux attach-session` doesn't exit when its stdout/stdin
  // go quiet — it stays attached to tmux forever. Every dashboard
  // restart then left behind an orphan tmux client whose dimensions
  // pinned the window size and caused the "dots on the right" snapshot
  // glitch (Claude Code truncating to the smaller window, dashboards
  // displaying at the larger client dims).
  try {
    hub.pty?.kill();
  } catch {
    // PTY may already have exited; nothing to do.
  }
}
