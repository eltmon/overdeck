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
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { activePtyHubs, broadcastToHub, removeClientFromHub, type PtyHub } from './pty-hub.js';

const execAsync = promisify(exec);

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

    ws.on('message', (data) => {
      const message = data.toString();
      if (messageHandler) {
        messageHandler(message);
      } else {
        earlyMessages.push(message);
        console.log(`[ws-terminal] Buffered early message for ${sessionName}: ${message.slice(0, 50)}...`);
      }
    });

    // Check if tmux session exists and set up PTY (async)
    (async () => {
      // Check if tmux session exists
      try {
        const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""');
        const sessions = stdout.trim().split('\n').filter(Boolean);
        if (!sessions.includes(sessionName)) {
          ws.close(1008, `Session ${sessionName} not found`);
          return;
        }
      } catch (err) {
        ws.close(1008, `Failed to list tmux sessions: ${err}`);
        return;
      }

      // ── Hub attachment ──────────────────────────────────────────────────────
      // If a hub already exists for this session, join it instead of spawning
      // a new PTY. The existing PTY keeps running; we just add this WebSocket
      // to its client set and force a repaint so this tab gets the current screen.
      const existingHub = activePtyHubs.get(sessionName);
      if (existingHub) {
        console.log(`[ws-terminal] Joining existing PTY hub for ${sessionName} (${existingHub.clients.size} existing clients)`);
        existingHub.clients.add(ws);
        // Most recently connected client takes over as input client
        existingHub.inputClient = ws;
        // 200ms blackout — prevents scrollback flood from existing PTY's tmux buffer
        existingHub.clientBlackout.set(ws, Date.now() + 200);

        // Force a SIGWINCH repaint so the new tab gets the current terminal state.
        // Toggle dimensions briefly: current -> current-1 -> current (two SIGWINCHs).
        const { cols, rows } = existingHub;
        setTimeout(() => {
          if (existingHub.clients.has(ws) && ws.readyState === WebSocket.OPEN) {
            try {
              existingHub.pty.resize(cols - 1, rows);
              execAsync(`tmux resize-window -t ${sessionName} -x ${cols - 1} -y ${rows} 2>/dev/null || true`)
                .then(() => new Promise<void>(r => setTimeout(r, 50)))
                .then(() => {
                  if (existingHub.clients.has(ws)) {
                    existingHub.pty.resize(cols, rows);
                    return execAsync(`tmux resize-window -t ${sessionName} -x ${cols} -y ${rows} 2>/dev/null || true`);
                  }
                })
                .catch(() => {});
            } catch {
              // PTY may have exited — ignore
            }
          }
        }, 100);

        const handleJoinMessage = (message: string) => {
          if (message.startsWith('{')) {
            try {
              const parsed = JSON.parse(message);
              if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
                existingHub.cols = parsed.cols;
                existingHub.rows = parsed.rows;
                try {
                  existingHub.pty.resize(parsed.cols, parsed.rows);
                } catch { /* ignore */ }
                execAsync(`tmux resize-window -t ${sessionName} -x ${parsed.cols} -y ${parsed.rows} 2>/dev/null || true`)
                  .catch(() => {});
                return;
              }
            } catch {
              // Invalid JSON, treat as terminal input
            }
          }
          // Only the active input client forwards keystrokes to the PTY.
          // This prevents double-echo when multiple browser tabs have the same terminal open.
          if (existingHub.inputClient !== ws) return;
          try {
            existingHub.pty.write(message);
          } catch { /* ignore */ }
        };

        messageHandler = handleJoinMessage;
        for (const msg of earlyMessages) {
          handleJoinMessage(msg);
        }
        earlyMessages.length = 0;

        ws.on('close', () => {
          console.log(`[ws-terminal] WebSocket closed for session: ${sessionName} (hub client removed)`);
          const lastClient = removeClientFromHub(activePtyHubs, sessionName, ws);
          if (lastClient) {
            console.log(`[ws-terminal] Last client disconnected for ${sessionName}, tearing down hub`);
            // PTY (tmux attach) exits naturally when pipes close — no kill needed.
          }
        });

        ws.on('error', (err) => {
          console.error(`[ws-terminal] WebSocket error for ${sessionName}:`, err);
          removeClientFromHub(activePtyHubs, sessionName, ws);
        });

        return; // Done — joined existing hub
      }

      // ── New hub creation ────────────────────────────────────────────────────
      // Pre-resize tmux window to reasonable default before PTY attach
      try {
        await execAsync(`tmux resize-window -t ${sessionName} -x 120 -y 29 2>/dev/null || true`, { timeout: 5000 });
      } catch {
        console.log(`[ws-terminal] Initial resize failed for ${sessionName}`);
      }

      let ptyProcess: pty.IPty | null = null;
      let ptyStarted = false;
      let lastResizeCols = 0;
      let lastResizeRows = 0;
      const pendingInput: string[] = [];

      const hub: PtyHub = {
        pty: null as unknown as pty.IPty, // filled in startLocalPty
        clients: new Set([ws]),
        cols: 120,
        rows: 29,
        inputClient: ws, // first client is the initial input client
        clientBlackout: new Map([[ws, Date.now() + 200]]), // 200ms blackout before forwarding starts
      };

      const startLocalPty = async (cols: number, rows: number) => {
        if (ptyStarted) return;

        // Check if the tmux session exists before spawning the PTY.
        // If we spawn without checking, tmux prints "can't find session" to the PTY,
        // that error text is relayed to the client as a WebSocket message, which
        // confuses the client's reconnect counter (it looks like real terminal data).
        // Close cleanly with no data so the client just sees ws.onclose.
        try {
          await execAsync(`tmux has-session -t ${JSON.stringify(sessionName)}`);
        } catch {
          console.log(`[ws-terminal] Session ${sessionName} does not exist — closing without PTY spawn`);
          ws.close(1000, 'session-not-found');
          return;
        }

        ptyStarted = true;
        lastResizeCols = cols;
        lastResizeRows = rows;
        hub.cols = cols;
        hub.rows = rows;

        console.log(`[ws-terminal] Starting local PTY for ${sessionName} at ${cols}x${rows}`);

        // Spawn PTY at client's exact dimensions. The PTY attachment causes tmux
        // to resize its window (window-size=latest), which sends SIGWINCH to Claude.
        ptyProcess = pty.spawn('tmux', ['attach-session', '-t', sessionName], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: homedir(),
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' } as { [key: string]: string },
        });

        hub.pty = ptyProcess;
        activePtyHubs.set(sessionName, hub);

        // Suppress initial PTY output — the first data burst contains the tmux screen
        // rendered at the OLD size (80x24 default). We drop it, wait for Claude to
        // process SIGWINCH (from our PTY attachment resizing the window), then force
        // a second SIGWINCH via dimension toggle to trigger a clean full repaint.
        let forwarding = false;

        // Broadcast PTY data to ALL connected clients
        ptyProcess.onData((data) => {
          if (!forwarding) return;
          broadcastToHub(hub, data);
        });

        // After 200ms: start forwarding, then force full repaint via dimension toggle.
        // The toggle (cols -> cols-1 -> cols) guarantees two SIGWINCHs, the last at the
        // correct size. Claude repaints its entire TUI and we forward the clean result.
        setTimeout(() => {
          forwarding = true;
          if (ptyProcess && hub.clients.size > 0) {
            // Toggle dimensions to force SIGWINCH + full repaint
            ptyProcess.resize(cols - 1, rows);
            execAsync(`tmux resize-window -t ${sessionName} -x ${cols - 1} -y ${rows} 2>/dev/null || true`)
              .then(() => new Promise<void>(r => setTimeout(r, 50)))
              .then(() => {
                if (ptyProcess && hub.clients.size > 0) {
                  ptyProcess.resize(cols, rows);
                  return execAsync(`tmux resize-window -t ${sessionName} -x ${cols} -y ${rows} 2>/dev/null || true`);
                }
              })
              .catch(() => {});
          }
        }, 200);

        // Handle PTY exit — close all client connections
        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[ws-terminal] PTY for ${sessionName} exited with code ${exitCode}`);
          activePtyHubs.delete(sessionName);
          for (const client of hub.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.close(1000, 'Session ended');
            }
          }
          hub.clients.clear();
        });

        // Flush any input that arrived while PTY was starting
        for (const input of pendingInput) {
          ptyProcess.write(input);
        }
        pendingInput.length = 0;
      };

      // Set up message handler for local sessions (using the buffered message pattern)
      const handleLocalMessage = (message: string) => {
        // Handle resize messages
        if (message.startsWith('{')) {
          try {
            const parsed = JSON.parse(message);
            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
              if (!ptyStarted) {
                // First resize message — start PTY with correct dimensions
                startLocalPty(parsed.cols, parsed.rows);
                return;
              }
              // Subsequent resize — update dimensions
              if (parsed.cols === lastResizeCols && parsed.rows === lastResizeRows) {
                return;
              }
              lastResizeCols = parsed.cols;
              lastResizeRows = parsed.rows;
              hub.cols = parsed.cols;
              hub.rows = parsed.rows;
              if (ptyProcess) {
                ptyProcess.resize(parsed.cols, parsed.rows);
                execAsync(`tmux resize-window -t ${sessionName} -x ${parsed.cols} -y ${parsed.rows} 2>/dev/null || true`)
                  .catch(() => {});
              }
              return;
            }
          } catch {
            // Invalid JSON, treat as terminal input
          }
        }

        // Terminal input — only forward if this client is the active input client.
        // This prevents double-echo if multiple tabs have the same session open.
        if (hub.inputClient !== ws) return;
        if (ptyProcess) {
          ptyProcess.write(message);
        } else {
          pendingInput.push(message);
        }
      };

      // Set the message handler and process any buffered early messages
      messageHandler = handleLocalMessage;
      for (const msg of earlyMessages) {
        handleLocalMessage(msg);
      }
      earlyMessages.length = 0;

      // Clean up on WebSocket close
      ws.on('close', () => {
        console.log(`[ws-terminal] WebSocket closed for session: ${sessionName}`);
        const lastClient = removeClientFromHub(activePtyHubs, sessionName, ws);
        if (lastClient) {
          console.log(`[ws-terminal] Last client disconnected for ${sessionName}, tearing down hub`);
          // PTY (tmux attach) exits naturally when pipes close — no kill needed.
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
