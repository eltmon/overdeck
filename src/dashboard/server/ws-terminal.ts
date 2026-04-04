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
 */

import http from 'node:http';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';

const execAsync = promisify(exec);

/** Tracks active PTY processes by session name — used for cleanup on reconnect. */
const activePtys = new Map<string, pty.IPty>();

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

      // Check for existing PTY connection and clean it up to prevent duplicates.
      // This can happen if user refreshes the page or opens multiple tabs.
      const existingPty = activePtys.get(sessionName);
      if (existingPty) {
        console.log(`[ws-terminal] Cleaning up existing PTY for ${sessionName} before creating new one`);
        try {
          existingPty.write('\x02d'); // Ctrl-b d to detach from tmux
          setTimeout(() => existingPty.kill(), 100);
        } catch {
          // Ignore errors during cleanup
        }
        activePtys.delete(sessionName);
      }

      // Pre-resize tmux window to reasonable default before PTY attach
      try {
        await execAsync(`tmux resize-window -t ${sessionName} -x 120 -y 29 2>/dev/null || true`, { timeout: 5000 });
      } catch {
        console.log(`[ws-terminal] Initial resize failed for ${sessionName}`);
      }

      // ── Local PTY handler ──────────────────────────────────────────────────
      // Uses node-pty with `tmux attach-session`.
      //
      // CRITICAL (PAN-417): Wait for the client's first resize message before
      // spawning the PTY. This ensures the PTY starts at the correct dimensions,
      // avoiding the dimension cascade (200x50 -> 120x30 -> actual) that garbled
      // terminal output. This matches the remote path's startFly() pattern.
      activePtys.delete(sessionName);

      let ptyProcess: pty.IPty | null = null;
      let ptyStarted = false;
      let lastResizeCols = 0;
      let lastResizeRows = 0;
      const pendingInput: string[] = [];

      const startLocalPty = (cols: number, rows: number) => {
        if (ptyStarted) return;
        ptyStarted = true;
        lastResizeCols = cols;
        lastResizeRows = rows;

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

        activePtys.set(sessionName, ptyProcess);

        // Suppress initial PTY output — the first data burst contains the tmux screen
        // rendered at the OLD size (80x24 default). We drop it, wait for Claude to
        // process SIGWINCH (from our PTY attachment resizing the window), then force
        // a second SIGWINCH via dimension toggle to trigger a clean full repaint.
        let forwarding = false;

        ptyProcess.onData((data) => {
          if (forwarding && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        // After 200ms: start forwarding, then force full repaint via dimension toggle.
        // The toggle (cols -> cols-1 -> cols) guarantees two SIGWINCHs, the last at the
        // correct size. Claude repaints its entire TUI and we forward the clean result.
        setTimeout(() => {
          forwarding = true;
          if (ptyProcess && ws.readyState === WebSocket.OPEN) {
            // Toggle dimensions to force SIGWINCH + full repaint
            ptyProcess.resize(cols - 1, rows);
            execAsync(`tmux resize-window -t ${sessionName} -x ${cols - 1} -y ${rows} 2>/dev/null || true`)
              .then(() => new Promise<void>(r => setTimeout(r, 50)))
              .then(() => {
                if (ptyProcess && ws.readyState === WebSocket.OPEN) {
                  ptyProcess.resize(cols, rows);
                  return execAsync(`tmux resize-window -t ${sessionName} -x ${cols} -y ${rows} 2>/dev/null || true`);
                }
              })
              .catch(() => {});
          }
        }, 200);

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[ws-terminal] PTY for ${sessionName} exited with code ${exitCode}`);
          activePtys.delete(sessionName);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Session ended');
          }
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

        // Terminal input — buffer if PTY not ready yet
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

      // Clean up on WebSocket close — do NOT kill the PTY, just remove from tracking.
      // The PTY (tmux attach) will exit naturally when pipes close.
      ws.on('close', () => {
        console.log(`[ws-terminal] WebSocket closed for session: ${sessionName}`);
        activePtys.delete(sessionName);
      });

      ws.on('error', (err) => {
        console.error(`[ws-terminal] WebSocket error for ${sessionName}:`, err);
        activePtys.delete(sessionName);
      });
    })();
  });

  console.log('[ws-terminal] Raw WebSocket terminal handler installed on /ws/terminal');
}
