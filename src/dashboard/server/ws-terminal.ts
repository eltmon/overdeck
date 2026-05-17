/**
 * Raw WebSocket terminal handler — bypasses Effect RPC for reliable PTY streaming.
 *
 * The Effect RPC stream approach queued terminal data but never delivered it to the
 * browser. This module restores the working raw WebSocket `/ws/terminal` endpoint
 * from pre-PAN-435 code.
 *
 * Exports a single function `setupTerminalWebSocket(server)` that installs a
 * `noServer` WebSocketServer on the given HTTP server's `upgrade` event for the
 * `/ws/terminal` path. Other upgrade paths (e.g., `/ws/rpc`) are left untouched.
 *
 * PAN-484: Multiple WebSocket clients (browser tabs) for the same tmux session
 * are handled via a shared PTY hub — one PTY process, many WebSocket clients.
 * Output is broadcast to all clients; any client can send input. PTY stays alive
 * until the last client disconnects.
 */

import http from 'node:http';
import { homedir } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { activePtyHubs, addClientToHub, broadcastToHub, removeClientFromHub, setClientReady, type PtyHub } from './pty-hub.js';
import { buildTmuxArgs, capturePaneAsync, getWindowDimensionsAsync, resizeWindowAsync, sessionExistsAsync } from '../../lib/tmux.js';
import { getReauthSessionToken, invalidateReauthToken } from './routes/codex-auth.js';
import { hasDashboardAuthHeaders } from './routes/dashboard-auth.js';
import { validateOriginHeaders } from './routes/origin-validation.js';
import { buildChildEnvWithoutTmux } from '../../lib/child-env.js';
import { getInternalToken } from '../../lib/internal-token.js';

type ClientControlMessage =
  | { type: 'attach'; cols: number; rows: number }
  | { type: 'ready' }
  | { type: 'resize'; cols: number; rows: number };

// Optional /ws/terminal cold-path + accumulation profiling. Enable with
// PANOPTICON_TERMINAL_PROFILE=1. Per-connection phase timings + a periodic
// snapshot (heap / hub-count / upgrade-listener / event-loop lag) so a
// slow-over-time regression can be triaged from the dashboard log alone.
const TERMINAL_PROFILE_ENABLED = process.env.PANOPTICON_TERMINAL_PROFILE === '1';

function profMark(sessionName: string, t0: bigint, label: string, extra?: string): void {
  if (!TERMINAL_PROFILE_ENABLED) return;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`[ws-terminal-prof] ${sessionName} +${ms.toFixed(1)}ms ${label}${extra ? ' ' + extra : ''}`);
}

async function profStep<T>(sessionName: string, t0: bigint, label: string, fn: () => Promise<T>): Promise<T> {
  if (!TERMINAL_PROFILE_ENABLED) return fn();
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    const dur = Number(process.hrtime.bigint() - start) / 1e6;
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`[ws-terminal-prof] ${sessionName} +${elapsed.toFixed(1)}ms ${label} took=${dur.toFixed(1)}ms`);
    return result;
  } catch (err) {
    const dur = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[ws-terminal-prof] ${sessionName} ${label} FAILED after ${dur.toFixed(1)}ms: ${err}`);
    throw err;
  }
}

const PROF_DASHBOARD_START = Date.now();
let PROF_CONNECTION_COUNT = 0;
let PROF_LAST_EL_LAG_MS = 0;
function measureEventLoopLag(): void {
  if (!TERMINAL_PROFILE_ENABLED) return;
  const t = process.hrtime.bigint();
  setImmediate(() => {
    PROF_LAST_EL_LAG_MS = Number(process.hrtime.bigint() - t) / 1e6;
  });
}
function getAccumStateLine(httpServer: http.Server): string {
  const heap = process.memoryUsage();
  const heapMB = (heap.heapUsed / 1024 / 1024).toFixed(1);
  const rssMB = (heap.rss / 1024 / 1024).toFixed(1);
  const upMin = ((Date.now() - PROF_DASHBOARD_START) / 60000).toFixed(1);
  const upgradeListeners = httpServer.listenerCount('upgrade');
  return `up=${upMin}min conns=${PROF_CONNECTION_COUNT} hubs=${activePtyHubs.size} heap=${heapMB}MB rss=${rssMB}MB upListeners=${upgradeListeners} elLag=${PROF_LAST_EL_LAG_MS.toFixed(1)}ms`;
}

function parseControlMessage(message: string): ClientControlMessage | null {
  if (!message.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(message) as ClientControlMessage;
    if (parsed.type === 'ready') return parsed;
    if ((parsed.type === 'attach' || parsed.type === 'resize') && parsed.cols > 0 && parsed.rows > 0) {
      return parsed;
    }
  } catch {
    // Ignore invalid JSON; caller treats it as terminal input.
  }
  return null;
}

function sendControl(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(`\u0000${JSON.stringify(payload)}`);
  }
}

function rejectUpgrade(socket: import('net').Socket, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function authorizeTerminalUpgrade(request: http.IncomingMessage): { ok: true } | { ok: false; status: number; message: string } {
  const originCheck = validateOriginHeaders(request.headers, request.method ?? 'GET');
  if (!originCheck.ok) {
    return { ok: false, status: 403, message: originCheck.error };
  }

  if (!getInternalToken()) {
    return { ok: false, status: 503, message: 'dashboard session token not configured' };
  }

  if (!hasDashboardAuthHeaders(request.headers)) {
    return { ok: false, status: 401, message: 'unauthorized' };
  }

  return { ok: true };
}

// Fresh-attach snapshot cap. 5000 lines with escape sequences was several megabytes
// on a busy session — the client then had to receive, parse, and write all of that
// before sending `ready` and letting live data through. 500 lines covers a generous
// scrollback window; override via env for sessions that really need deeper history.
const SNAPSHOT_SCROLLBACK_LINES = (() => {
  const parsed = Number(process.env.PANOPTICON_TERMINAL_SNAPSHOT_LINES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 500;
})();

/**
 * Snapshot for a fresh attach (no existing hub).
 *
 * Always captures at tmux's current dimensions — never resizes first.
 * Resizing before capture caused a "letters all over the place" glitch:
 * tmux's grid changed instantly but the inner program (Claude Code, etc.)
 * hadn't redrawn yet, so the snapshot contained old content in a new-width
 * grid.
 *
 * By capturing at the current dims, the snapshot is always consistent with
 * the rendered content. The client resizes xterm to match the snapshot dims,
 * paints the content immediately, then the PTY attach drives the resize to
 * the client's actual dims via the normal resize path.
 */
async function captureFreshSnapshot(
  sessionName: string,
  requestedCols: number,
  requestedRows: number,
): Promise<{ cols: number; rows: number; data: string }> {
  // Dimensions and pane content are independent reads — run in parallel so the
  // snapshot's wall-time is max(getWindowDimensions, capturePane), not sum.
  const tPar = TERMINAL_PROFILE_ENABLED ? process.hrtime.bigint() : 0n;
  const [dims, data] = await Promise.all([
    getWindowDimensionsAsync(sessionName),
    capturePaneAsync(sessionName, SNAPSHOT_SCROLLBACK_LINES, { escapeSequences: true }),
  ]);
  if (TERMINAL_PROFILE_ENABLED) {
    console.log(`[ws-terminal-prof] ${sessionName}   parallel(dims+capture lines=${SNAPSHOT_SCROLLBACK_LINES},esc) took=${(Number(process.hrtime.bigint() - tPar) / 1e6).toFixed(1)}ms bytes=${data.length}`);
  }
  if (!dims) {
    return { cols: requestedCols, rows: requestedRows, data: '' };
  }
  return { cols: dims.cols, rows: dims.rows, data };
}

/**
 * Snapshot for a hub-join (a second/Nth client attaching to an already-running
 * PTY). The PTY is actively streaming and the hub already holds the authoritative
 * dimensions, so we skip the resize and capture only the visible viewport —
 * anything past the viewport will be re-delivered as the tmux redraw stream
 * naturally covers it. `-S 0` starts capture from the first visible line.
 */
async function captureViewportSnapshot(sessionName: string): Promise<string> {
  return capturePaneAsync(sessionName, 0, { escapeSequences: true });
}

/**
 * Install the raw WebSocket terminal handler on the given HTTP server.
 *
 * Handles `upgrade` requests for `/ws/terminal?session=<name>`. All other
 * upgrade paths are passed through to any existing listeners (e.g., Effect RPC).
 */
export function setupTerminalWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Intercept upgrade events: handle /ws/terminal ourselves, pass everything
  // else to Effect's handler. We monkey-patch server.on('upgrade', ...) so that
  // when Effect registers its handler later, we wrap it to skip /ws/terminal.
  const originalOn = server.on.bind(server);
  server.on = function(event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      // Wrap the listener to skip /ws/terminal upgrades
      const wrapped = (request: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        if (url.pathname === '/ws/terminal') return; // We handle this
        (listener as (req: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  // Register our own handler for /ws/terminal
  originalOn('upgrade', (request: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    if (url.pathname === '/ws/terminal') {
      const auth = authorizeTerminalUpgrade(request);
      if (!auth.ok) {
        rejectUpgrade(socket, auth.status, auth.message);
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Periodic accumulation snapshot — opt-in via PANOPTICON_TERMINAL_PROFILE=1.
  if (TERMINAL_PROFILE_ENABLED) {
    setInterval(() => {
      measureEventLoopLag();
      console.log(`[ws-terminal-accum] ${getAccumStateLine(server)}`);
    }, 30000);
  }

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const tProf = process.hrtime.bigint();
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionName = url.searchParams.get('session');

    if (!sessionName) {
      ws.close(1008, 'Session name required');
      return;
    }

    // Re-auth sessions require a valid one-time token to prevent hijacking.
    if (sessionName.startsWith('reauth-')) {
      const token = url.searchParams.get('token');
      const expected = getReauthSessionToken(sessionName);
      if (!token || !expected || expected !== token) {
        ws.close(1008, 'Invalid or missing re-auth token');
        return;
      }
      invalidateReauthToken(sessionName);
    }

    console.log(`[ws-terminal] WebSocket connected for session: ${sessionName}`);
    if (TERMINAL_PROFILE_ENABLED) {
      PROF_CONNECTION_COUNT += 1;
      measureEventLoopLag();
      console.log(`[ws-terminal-accum] @connect ${sessionName} ${getAccumStateLine(server)}`);
    }
    profMark(sessionName, tProf, 'connection');

    // Buffer messages immediately to avoid losing them during async setup.
    // The client sends resize dimensions immediately on connect, but we have async
    // operations (tmux checks) that take time. Without buffering, messages are lost.
    const earlyMessages: string[] = [];
    let messageHandler: ((data: string) => void) | null = null;
    let resolvePendingAttach: ((attach: Extract<ClientControlMessage, { type: 'attach' }> | null) => void) | null = null;

    ws.on('message', (data) => {
      const message = data.toString();
      if (messageHandler) {
        messageHandler(message);
      } else {
        earlyMessages.push(message);
        console.log(`[ws-terminal] Buffered early message for ${sessionName}: ${message.slice(0, 50)}...`);
      }
    });

    ws.on('close', () => {
      if (resolvePendingAttach) {
        resolvePendingAttach(null);
        resolvePendingAttach = null;
      }
    });

    // Check if tmux session exists and set up PTY (async).
    // Use a targeted `has-session` (sessionExistsAsync) instead of listing all
    // sessions — same answer, one short tmux call vs. enumerating every session.
    (async () => {
      try {
        const exists = await profStep(sessionName, tProf, 'sessionExistsAsync', () => sessionExistsAsync(sessionName));
        if (!exists) {
          ws.close(4404, 'session-not-found');
          return;
        }
      } catch (err) {
        ws.close(1008, `Failed to check tmux session: ${err}`);
        return;
      }

      let attachMessage: Extract<ClientControlMessage, { type: 'attach' }> | null = null;
      const attachPromise = new Promise<Extract<ClientControlMessage, { type: 'attach' }> | null>((resolve) => {
        resolvePendingAttach = resolve;
      });
      const remainingMessages: string[] = [];
      for (const msg of earlyMessages) {
        const parsed = parseControlMessage(msg);
        if (!attachMessage && parsed?.type === 'attach') {
          attachMessage = parsed;
        } else {
          remainingMessages.push(msg);
        }
      }
      earlyMessages.length = 0;

      const handlePreAttachMessage = (message: string) => {
        const parsed = parseControlMessage(message);
        if (!attachMessage && parsed?.type === 'attach') {
          attachMessage = parsed;
          resolvePendingAttach?.(parsed);
          resolvePendingAttach = null;
          return;
        }
        remainingMessages.push(message);
      };

      messageHandler = handlePreAttachMessage;
      if (!attachMessage) {
        attachMessage = await attachPromise;
      }
      if (!attachMessage) {
        return;
      }
      profMark(sessionName, tProf, 'attach received', `cols=${attachMessage.cols} rows=${attachMessage.rows}`);

      const requestedCols = attachMessage.cols;
      const requestedRows = attachMessage.rows;

      const existingHub = activePtyHubs.get(sessionName);
      if (existingHub) {
        console.log(`[ws-terminal] Joining existing PTY hub for ${sessionName} (${existingHub.clients.size} existing clients)`);
        profMark(sessionName, tProf, 'existing-hub branch', `clients=${existingHub.clients.size}`);
        addClientToHub(existingHub, ws, false);
        existingHub.inputClient = ws;

        const dimsMatchHub = existingHub.cols === requestedCols && existingHub.rows === requestedRows;

        if (dimsMatchHub) {
          // Hub already at the new client's requested dims — capture viewport
          // content and hand it to the new client directly. The captured
          // content is valid at both the hub and the client's dims (same
          // number), so it paints cleanly and no resize dance is needed.
          const snapshot = await profStep(sessionName, tProf, 'captureViewportSnapshot', () => captureViewportSnapshot(sessionName));
          profMark(sessionName, tProf, 'sending snapshot (hub-join)', `bytes=${snapshot.length}`);
          sendControl(ws, { type: 'snapshot', cols: existingHub.cols, rows: existingHub.rows, data: snapshot });
        } else {
          // Hub is at different dims than the new client needs. Sending the
          // hub's current viewport would force the new client's xterm to
          // the hub's dims, painting stale content (including mid-frame
          // Claude Code spinners) laid out for the wrong width until the
          // post-ready resize caught up — a visible 1–2 s glitch.
          //
          // Instead, resize the hub to the new client now: update hub dims,
          // resize the PTY (drives SIGWINCH to the inner program), resize
          // the tmux window, and broadcast a size frame to the other
          // clients so their xterms follow. The new client gets an empty
          // snapshot at its requested dims — the clean live redraw stream
          // from Claude Code's SIGWINCH response is the first content it
          // sees.
          existingHub.cols = requestedCols;
          existingHub.rows = requestedRows;
          try {
            existingHub.pty.resize(requestedCols, requestedRows);
          } catch {
            // PTY may be mid-teardown; subsequent operations will notice.
          }
          resizeWindowAsync(sessionName, requestedCols, requestedRows).catch(() => {});
          for (const client of existingHub.clients) {
            if (client !== ws) {
              sendControl(client, { type: 'size', cols: requestedCols, rows: requestedRows });
            }
          }
          sendControl(ws, { type: 'snapshot', cols: requestedCols, rows: requestedRows, data: '' });
        }

        const handleJoinMessage = (message: string) => {
          const parsed = parseControlMessage(message);
          if (parsed?.type === 'ready') {
            setClientReady(existingHub, ws);
            return;
          }
          if (parsed?.type === 'resize') {
            if (existingHub.inputClient !== ws) {
              sendControl(ws, { type: 'size', cols: existingHub.cols, rows: existingHub.rows });
              return;
            }
            if (parsed.cols === existingHub.cols && parsed.rows === existingHub.rows) return;
            existingHub.cols = parsed.cols;
            existingHub.rows = parsed.rows;
            try {
              existingHub.pty.resize(parsed.cols, parsed.rows);
            } catch {
              return;
            }
            resizeWindowAsync(sessionName, parsed.cols, parsed.rows)
              .catch(() => {});
            for (const client of existingHub.clients) {
              sendControl(client, { type: 'size', cols: parsed.cols, rows: parsed.rows });
            }
            return;
          }
          if (parsed?.type === 'attach') {
            return;
          }
          if (existingHub.inputClient !== ws) return;
          try {
            existingHub.pty.write(message);
          } catch {
            // Ignore PTY write races on disconnect.
          }
        };

        messageHandler = handleJoinMessage;
        for (const msg of remainingMessages) {
          handleJoinMessage(msg);
        }

        ws.on('close', () => {
          console.log(`[ws-terminal] WebSocket closed for session: ${sessionName} (hub client removed)`);
          const lastClient = removeClientFromHub(activePtyHubs, sessionName, ws);
          if (lastClient) {
            console.log(`[ws-terminal] Last client disconnected for ${sessionName}, tearing down hub`);
          }
        });

        ws.on('error', (err) => {
          console.error(`[ws-terminal] WebSocket error for ${sessionName}:`, err);
          removeClientFromHub(activePtyHubs, sessionName, ws);
        });

        return;
      }

      let ptyProcess: pty.IPty | null = null;
      let ptyStarted = false;
      const pendingInput: string[] = [];

      const hub: PtyHub = {
        pty: null as unknown as pty.IPty,
        clients: new Set(),
        cols: requestedCols,
        rows: requestedRows,
        inputClient: ws,
        clientStates: new Map(),
      };

      addClientToHub(hub, ws, false);

      const startLocalPty = async () => {
        if (ptyStarted) return;
        // The session-exists check at the top of the connection handler already
        // verified the session is present. A second `has-session` here was pure
        // duplication. If the session vanished between the two checks, the PTY
        // spawn will fail immediately and `onExit` cleans up.
        ptyStarted = true;
        console.log(`[ws-terminal] Starting local PTY for ${sessionName} at ${hub.cols}x${hub.rows}`);
        profMark(sessionName, tProf, 'pty.spawn begin');
        // Strip TMUX/TMUX_PANE from inherited env so `tmux attach-session` doesn't refuse
        // with "sessions should be nested with care, unset $TMUX to force" when the
        // dashboard server itself was launched from inside a tmux pane.
        ptyProcess = pty.spawn('tmux', buildTmuxArgs(['attach-session', '-t', sessionName]), {
          name: 'xterm-256color',
          cols: hub.cols,
          rows: hub.rows,
          cwd: homedir(),
          env: buildChildEnvWithoutTmux(process.env, {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'en_US.UTF-8',
          }) as { [key: string]: string },
        });

        hub.pty = ptyProcess;
        activePtyHubs.set(sessionName, hub);
        profMark(sessionName, tProf, 'pty.spawn complete');

        let ptyChunks = 0;
        let ptyBytes = 0;
        let firstByteLogged = false;
        const ptyDiagInterval = setInterval(() => {
          if (ptyChunks === 0) return;
          const maxBuf = Math.max(...[...hub.clients].map(c => c.bufferedAmount));
          console.log(`[ws-terminal] PTY ${sessionName}: ${ptyChunks} chunks, ${ptyBytes}B in last 5s, ws-buf=${maxBuf}`);
          ptyChunks = 0;
          ptyBytes = 0;
        }, 5000);

        ptyProcess.onData((data) => {
          if (!firstByteLogged) {
            firstByteLogged = true;
            profMark(sessionName, tProf, 'first PTY data byte', `len=${data.length}`);
          }
          ptyChunks++;
          ptyBytes += data.length;
          broadcastToHub(hub, data);
        });

        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[ws-terminal] PTY for ${sessionName} exited with code ${exitCode}`);
          clearInterval(ptyDiagInterval);
          activePtyHubs.delete(sessionName);
          for (const client of hub.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.close(1000, 'Session ended');
            }
          }
          hub.clients.clear();
          hub.clientStates.clear();
        });

        for (const input of pendingInput) {
          ptyProcess.write(input);
        }
        pendingInput.length = 0;
      };

      const snapshot = await profStep(sessionName, tProf, 'captureFreshSnapshot', () => captureFreshSnapshot(sessionName, requestedCols, requestedRows));
      profMark(sessionName, tProf, 'sending snapshot (fresh)', `bytes=${snapshot.data.length}`);
      sendControl(ws, { type: 'snapshot', cols: snapshot.cols, rows: snapshot.rows, data: snapshot.data });
      // Start PTY immediately — don't wait for client 'ready'. The hub buffers
      // live data for not-yet-ready clients (pty-hub.ts broadcastToHub), so data
      // that arrives before the client finishes processing its snapshot is queued
      // and flushed when setClientReady fires. This eliminates the visible black
      // screen gap between snapshot delivery and first live byte.
      void startLocalPty();

      const handleLocalMessage = (message: string) => {
        const parsed = parseControlMessage(message);
        if (parsed?.type === 'ready') {
          setClientReady(hub, ws);
          return;
        }
        if (parsed?.type === 'resize') {
          if (hub.inputClient !== ws) {
            sendControl(ws, { type: 'size', cols: hub.cols, rows: hub.rows });
            return;
          }
          if (parsed.cols === hub.cols && parsed.rows === hub.rows) return;
          hub.cols = parsed.cols;
          hub.rows = parsed.rows;
          if (ptyProcess) {
            ptyProcess.resize(parsed.cols, parsed.rows);
            resizeWindowAsync(sessionName, parsed.cols, parsed.rows)
              .catch(() => {});
            for (const client of hub.clients) {
              sendControl(client, { type: 'size', cols: parsed.cols, rows: parsed.rows });
            }
          }
          return;
        }
        if (parsed?.type === 'attach') {
          return;
        }
        if (hub.inputClient !== ws) return;
        if (ptyProcess) {
          ptyProcess.write(message);
        } else {
          pendingInput.push(message);
        }
      };

      messageHandler = handleLocalMessage;
      for (const msg of remainingMessages) {
        handleLocalMessage(msg);
      }

      ws.on('close', () => {
        console.log(`[ws-terminal] WebSocket closed for session: ${sessionName}`);
        const lastClient = removeClientFromHub(activePtyHubs, sessionName, ws);
        if (lastClient) {
          console.log(`[ws-terminal] Last client disconnected for ${sessionName}, tearing down hub`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[ws-terminal] WebSocket error for ${sessionName}:`, err);
        removeClientFromHub(activePtyHubs, sessionName, ws);
      });
    })();
  });

  console.log('[ws-terminal] Raw WebSocket terminal handler installed on /ws/terminal');
}
