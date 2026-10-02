/**
 * App-level heartbeat for /ws/terminal (PAN-4434). Proxies such as Cloudflare
 * close a WebSocket after ~100 s without traffic, so an opted-in connection
 * (`?heartbeat=1`) gets a `\u0000{"type":"ping"}` control frame every 20 s,
 * and a client that sends nothing for two consecutive intervals is terminated.
 * A data frame is used instead of ws.ping() because every proxy counts it as
 * traffic. This module never imports ws-terminal.ts; the caller passes the
 * ping sender.
 */
import type { WebSocket } from 'ws';

export const TERMINAL_HEARTBEAT_INTERVAL_MS = 20_000;
export const TERMINAL_HEARTBEAT_MAX_MISSED = 2;
export const TERMINAL_HEARTBEAT_QUERY_PARAM = 'heartbeat';

/** True when the upgrade URL opted in with `heartbeat=1`. */
export function wantsTerminalHeartbeat(url: URL): boolean {
  return url.searchParams.get(TERMINAL_HEARTBEAT_QUERY_PARAM) === '1';
}

/** Start the heartbeat for one socket; returns a stop function. */
export function startTerminalHeartbeat(ws: WebSocket, sendPing: () => void): () => void {
  let receivedSinceTick = false;
  let missed = 0;
  ws.on('message', () => {
    receivedSinceTick = true;
  });
  const timer = setInterval(() => {
    missed = receivedSinceTick ? 0 : missed + 1;
    receivedSinceTick = false;
    if (missed >= TERMINAL_HEARTBEAT_MAX_MISSED) {
      clearInterval(timer);
      console.warn(`[ws-terminal] No client traffic for ${TERMINAL_HEARTBEAT_MAX_MISSED} heartbeat intervals; terminating`);
      ws.terminate();
      return;
    }
    sendPing();
  }, TERMINAL_HEARTBEAT_INTERVAL_MS);
  const stop = () => clearInterval(timer);
  ws.once('close', stop);
  ws.once('error', stop);
  return stop;
}
