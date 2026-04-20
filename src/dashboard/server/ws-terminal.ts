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
import { buildTmuxCommandString, buildTmuxArgs, capturePaneAsync, listSessionNamesAsync, resizeWindowAsync, sessionExistsAsync } from '../../lib/tmux.js';

type ClientControlMessage =
  | { type: 'attach'; cols: number; rows: number }
  | { type: 'ready' }
  | { type: 'resize'; cols: number; rows: number };

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

// Fresh-attach snapshot cap. 5000 lines with escape sequences was several megabytes
// on a busy session — the client then had to receive, parse, and write all of that
// before sending `ready` and letting live data through. 500 lines covers a generous
// scrollback window; override via env for sessions that really need deeper history.
const SNAPSHOT_SCROLLBACK_LINES = (() => {
  const parsed = Number(process.env.PANOPTICON_TERMINAL_SNAPSHOT_LINES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 500;
})();

/**
 * Snapshot for a fresh attach (no existing hub). Resizes the tmux window to the
 * client's requested dimensions, then captures up to SNAPSHOT_SCROLLBACK_LINES
 * lines of scrollback so the user sees prior context on first draw.
 */
async function captureFreshSnapshot(sessionName: string, cols: number, rows: number): Promise<string> {
  await resizeWindowAsync(sessionName, cols, rows).catch(() => {});
  return capturePaneAsync(sessionName, SNAPSHOT_SCROLLBACK_LINES, { escapeSequences: true });
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

    console.log(`[ws-terminal] WebSocket connected for session: ${sessionName}`);

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

    // Check if tmux session exists and set up PTY (async)
    (async () => {
      try {
        const sessions = await listSessionNamesAsync();
        if (!sessions.includes(sessionName)) {
          ws.close(1008, `Session ${sessionName} not found`);
          return;
        }
      } catch (err) {
        ws.close(1008, `Failed to list tmux sessions: ${err}`);
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

      const existingHub = activePtyHubs.get(sessionName);
      if (existingHub) {
        console.log(`[ws-terminal] Joining existing PTY hub for ${sessionName} (${existingHub.clients.size} existing clients)`);
        addClientToHub(existingHub, ws, false);
        existingHub.inputClient = ws;

        const snapshot = await captureViewportSnapshot(sessionName);
        sendControl(ws, { type: 'snapshot', cols: existingHub.cols, rows: existingHub.rows, data: snapshot });

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

      const requestedCols = attachMessage.cols;
      const requestedRows = attachMessage.rows;
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
        try {
          const exists = await sessionExistsAsync(sessionName);
          if (!exists) {
            console.log(`[ws-terminal] Session ${sessionName} does not exist — closing without PTY spawn`);
            ws.close(1000, 'session-not-found');
            return;
          }
        } catch {
          console.log(`[ws-terminal] Session ${sessionName} does not exist — closing without PTY spawn`);
          ws.close(1000, 'session-not-found');
          return;
        }

        ptyStarted = true;
        console.log(`[ws-terminal] Starting local PTY for ${sessionName} at ${hub.cols}x${hub.rows}`);
        ptyProcess = pty.spawn('tmux', buildTmuxArgs(['attach-session', '-t', sessionName]), {
          name: 'xterm-256color',
          cols: hub.cols,
          rows: hub.rows,
          cwd: homedir(),
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' } as { [key: string]: string },
        });

        hub.pty = ptyProcess;
        activePtyHubs.set(sessionName, hub);

        ptyProcess.onData((data) => {
          broadcastToHub(hub, data);
        });

        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[ws-terminal] PTY for ${sessionName} exited with code ${exitCode}`);
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

      const snapshot = await captureFreshSnapshot(sessionName, requestedCols, requestedRows);
      sendControl(ws, { type: 'snapshot', cols: requestedCols, rows: requestedRows, data: snapshot });

      const handleLocalMessage = (message: string) => {
        const parsed = parseControlMessage(message);
        if (parsed?.type === 'ready') {
          setClientReady(hub, ws);
          void startLocalPty();
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
