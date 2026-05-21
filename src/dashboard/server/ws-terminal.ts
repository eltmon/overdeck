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
import { buildTmuxArgs, capturePaneAsync, getWindowDimensionsAsync, listSessionNamesAsync, resizeWindowAsync, sessionExistsAsync } from '../../lib/tmux.js';
import { consumeReauthTerminalToken } from './routes/codex-auth.js';
import { validateOriginHeaders } from './routes/origin-validation.js';
import { buildChildEnvWithoutTmux } from '../../lib/child-env.js';
import { Effect } from 'effect';
import { isRespawnPending, waitForSessionRespawn } from './services/pending-respawn.js';

// Worst-case respawn window for switch-model / resume / restart-all is
// dominated by `waitForClaudePrompt`'s 30s ceiling. 35s gives a comfortable
// margin for the surrounding kill + spawn + tmux-up overhead.
const RESPAWN_WAIT_MS = 35_000;

type ClientControlMessage =
  | { type: 'attach'; cols: number; rows: number }
  | { type: 'ready' }
  | { type: 'resize'; cols: number; rows: number };

const ATTACH_TIMEOUT_MS = 5000;
const PRE_ATTACH_MAX_MESSAGES = 32;
const PRE_ATTACH_MAX_BYTES = 64 * 1024;

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
  // Hotfix for #1166: PAN-457 added an internal-token + session-cookie gate
  // here that broke every terminal panel when the dashboard is reached via
  // Traefik (https://pan.localhost) instead of `pan up`'s bootstrapped URL.
  // Origin validation is sufficient to block cross-origin browser attacks
  // (a tab on evil.example.com cannot forge Origin: https://pan.localhost),
  // which is the realistic threat model for a localhost dev tool. Re-add the
  // gate properly per the acceptance criteria in #1166 before reintroducing.
  const originCheck = validateOriginHeaders(request.headers, request.method ?? 'GET');
  if (!originCheck.ok) {
    return { ok: false, status: 403, message: originCheck.error };
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
  const dims = await getWindowDimensionsAsync(sessionName);
  if (!dims) {
    return { cols: requestedCols, rows: requestedRows, data: '' };
  }
  const data = await capturePaneAsync(sessionName, SNAPSHOT_SCROLLBACK_LINES, { escapeSequences: true });
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

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionName = url.searchParams.get('session');

    if (!sessionName) {
      ws.close(1008, 'Session name required');
      return;
    }

    // Re-auth sessions require a server-issued one-time terminal token to prevent hijacking.
    if (sessionName.startsWith('reauth-')) {
      const cookie = req.headers.cookie ?? '';
      const token = cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('pan_codex_reauth='))
        ?.slice('pan_codex_reauth='.length);
      let decodedToken = '';
      try {
        decodedToken = token ? decodeURIComponent(token) : '';
      } catch {
        decodedToken = '';
      }
      const [cookieSessionName, terminalToken] = decodedToken.split(':');
      if (cookieSessionName !== sessionName || !consumeReauthTerminalToken(sessionName, terminalToken)) {
        ws.close(1008, 'Invalid or missing re-auth token');
        return;
      }
    }

    console.log(`[ws-terminal] WebSocket connected for session: ${sessionName}`);

    // Buffer messages immediately to avoid losing them during async setup.
    // The client sends resize dimensions immediately on connect, but we have async
    // operations (tmux checks) that take time. Without buffering, messages are lost.
    const earlyMessages: string[] = [];
    let preAttachBytes = 0;
    let messageHandler: ((data: string) => void) | null = null;
    let resolvePendingAttach: ((attach: Extract<ClientControlMessage, { type: 'attach' }> | null) => void) | null = null;

    const bufferPreAttachMessage = (message: string): boolean => {
      preAttachBytes += Buffer.byteLength(message);
      if (earlyMessages.length >= PRE_ATTACH_MAX_MESSAGES || preAttachBytes > PRE_ATTACH_MAX_BYTES) {
        ws.close(1008, 'attach-handshake-too-large');
        return false;
      }
      earlyMessages.push(message);
      return true;
    };

    ws.on('message', (data) => {
      const message = data.toString();
      if (messageHandler) {
        messageHandler(message);
      } else if (bufferPreAttachMessage(message)) {
        console.log(`[ws-terminal] Buffered early message for ${sessionName}: ${message.slice(0, 50)}...`);
      }
    });

    ws.on('close', () => {
      if (resolvePendingAttach) {
        resolvePendingAttach(null);
        resolvePendingAttach = null;
      }
    });

    // Check if tmux session exists and set up PTY (async)
    (async () => {
      try {
        const sessions = await listSessionNamesAsync();
        if (!sessions.includes(sessionName)) {
          // The session may legitimately be gone, OR it may be in the
          // middle of a switch-model / resume / restart-all kill→spawn
          // cycle. The frontend treats 4404 as fatal (no retry), so
          // emitting it during a respawn gap leaves the terminal panel
          // stuck on "Could not reconnect" even after the new session
          // is up. Wait for the respawn to land before deciding.
          if (isRespawnPending(sessionName)) {
            const cameBack = await waitForSessionRespawn(sessionName, RESPAWN_WAIT_MS);
            if (!cameBack) {
              ws.close(4404, 'session-not-found');
              return;
            }
          } else {
            ws.close(4404, 'session-not-found');
            return;
          }
        }
      } catch (err) {
        ws.close(1008, `Failed to list tmux sessions: ${err}`);
        return;
      }

      let attachMessage: Extract<ClientControlMessage, { type: 'attach' }> | null = null;
      let attachTimer: ReturnType<typeof setTimeout> | null = null;
      const attachPromise = new Promise<Extract<ClientControlMessage, { type: 'attach' }> | null>((resolve) => {
        resolvePendingAttach = resolve;
        attachTimer = setTimeout(() => {
          ws.close(1008, 'attach-handshake-timeout');
          resolve(null);
        }, ATTACH_TIMEOUT_MS);
      });
      const remainingMessages: string[] = [];
      let remainingBytes = 0;
      for (const msg of earlyMessages) {
        const parsed = parseControlMessage(msg);
        if (!attachMessage && parsed?.type === 'attach') {
          attachMessage = parsed;
        } else if (remainingMessages.length < PRE_ATTACH_MAX_MESSAGES && remainingBytes <= PRE_ATTACH_MAX_BYTES) {
          remainingBytes += Buffer.byteLength(msg);
          remainingMessages.push(msg);
        } else {
          ws.close(1008, 'attach-handshake-too-large');
          return;
        }
      }
      earlyMessages.length = 0;

      const handlePreAttachMessage = (message: string) => {
        const parsed = parseControlMessage(message);
        if (!attachMessage && parsed?.type === 'attach') {
          attachMessage = parsed;
          if (attachTimer) clearTimeout(attachTimer);
          resolvePendingAttach?.(parsed);
          resolvePendingAttach = null;
          return;
        }
        remainingBytes += Buffer.byteLength(message);
        if (remainingMessages.length >= PRE_ATTACH_MAX_MESSAGES || remainingBytes > PRE_ATTACH_MAX_BYTES) {
          ws.close(1008, 'attach-handshake-too-large');
          resolvePendingAttach?.(null);
          resolvePendingAttach = null;
          return;
        }
        remainingMessages.push(message);
      };

      messageHandler = handlePreAttachMessage;
      if (!attachMessage) {
        attachMessage = await attachPromise;
      }
      if (attachTimer) clearTimeout(attachTimer);
      if (!attachMessage) {
        return;
      }

      const requestedCols = attachMessage.cols;
      const requestedRows = attachMessage.rows;

      const existingHub = activePtyHubs.get(sessionName);
      if (existingHub) {
        console.log(`[ws-terminal] Joining existing PTY hub for ${sessionName} (${existingHub.clients.size} existing clients)`);
        addClientToHub(existingHub, ws, false);
        existingHub.inputClient = ws;

        const dimsMatchHub = existingHub.cols === requestedCols && existingHub.rows === requestedRows;

        if (dimsMatchHub) {
          // Hub already at the new client's requested dims — capture viewport
          // content and hand it to the new client directly. The captured
          // content is valid at both the hub and the client's dims (same
          // number), so it paints cleanly and no resize dance is needed.
          const snapshot = await captureViewportSnapshot(sessionName);
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
            existingHub.pty?.resize(requestedCols, requestedRows);
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
              existingHub.pty?.resize(parsed.cols, parsed.rows);
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
          if (!existingHub.pty) {
            existingHub.pendingInput.push(message);
            return;
          }
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

      const hub: PtyHub = {
        pty: null,
        clients: new Set(),
        cols: requestedCols,
        rows: requestedRows,
        pendingInput: [],
        inputClient: ws,
        clientStates: new Map(),
      };

      activePtyHubs.set(sessionName, hub);
      addClientToHub(hub, ws, false);

      const startLocalPty = async () => {
        if (ptyStarted) return;
        try {
          let exists = await sessionExistsAsync(sessionName);
          // Mirror the upfront 4404 guard: tolerate the kill→spawn gap of
          // an in-progress respawn rather than emitting fatal 4404 the
          // client won't retry.
          if (!exists && isRespawnPending(sessionName)) {
            exists = await waitForSessionRespawn(sessionName, RESPAWN_WAIT_MS);
          }
          if (!exists) {
            console.log(`[ws-terminal] Session ${sessionName} does not exist — closing without PTY spawn`);
            // Use 4404 (private-use range) so the client can distinguish
            // "session doesn't exist" from "normal disconnect". The client
            // should NOT retry on 4404 — the session is gone.
            activePtyHubs.delete(sessionName);
            ws.close(4404, 'session-not-found');
            return;
          }
        } catch {
          console.log(`[ws-terminal] Session ${sessionName} does not exist — closing without PTY spawn`);
          activePtyHubs.delete(sessionName);
          ws.close(4404, 'session-not-found');
          return;
        }

        ptyStarted = true;
        console.log(`[ws-terminal] Starting local PTY for ${sessionName} at ${hub.cols}x${hub.rows}`);
        // Strip TMUX/TMUX_PANE from inherited env so `tmux attach-session` doesn't refuse
        // with "sessions should be nested with care, unset $TMUX to force" when the
        // dashboard server itself was launched from inside a tmux pane.
        ptyProcess = pty.spawn('tmux', buildTmuxArgs(['attach-session', '-t', sessionName]), {
          name: 'xterm-256color',
          cols: hub.cols,
          rows: hub.rows,
          cwd: homedir(),
          env: Effect.runSync(buildChildEnvWithoutTmux(process.env, {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'en_US.UTF-8',
          })) as { [key: string]: string },
        });

        hub.pty = ptyProcess;

        let ptyChunks = 0;
        let ptyBytes = 0;
        const ptyDiagInterval = setInterval(() => {
          if (ptyChunks === 0) return;
          const maxBuf = Math.max(...[...hub.clients].map(c => c.bufferedAmount));
          console.log(`[ws-terminal] PTY ${sessionName}: ${ptyChunks} chunks, ${ptyBytes}B in last 5s, ws-buf=${maxBuf}`);
          ptyChunks = 0;
          ptyBytes = 0;
        }, 5000);

        ptyProcess.onData((data) => {
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

        for (const input of hub.pendingInput) {
          ptyProcess.write(input);
        }
        hub.pendingInput.length = 0;
      };

      let snapshot: { cols: number; rows: number; data: string };
      try {
        snapshot = await captureFreshSnapshot(sessionName, requestedCols, requestedRows);
      } catch (err) {
        activePtyHubs.delete(sessionName);
        ws.close(1008, `Failed to capture terminal snapshot: ${err}`);
        return;
      }
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
          hub.pendingInput.push(message);
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
