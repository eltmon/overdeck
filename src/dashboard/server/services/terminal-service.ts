/**
 * TerminalService — dual-runtime PTY terminal streaming (PAN-428 B20)
 *
 * Implements the terminal RPC surface: open, write, resize, close, and
 * streamSession. Uses Bun.spawn under Bun and node-pty under Node.
 *
 * Key behaviours (from CLAUDE.md + existing /ws/terminal handler):
 *  - Deferred PTY spawn: PTY is not started until the first resize call.
 *  - Stale data suppression: suppress ~200ms of initial PTY burst, then
 *    toggle dimensions to force SIGWINCH + full repaint.
 *  - On stream/close: do NOT kill the PTY — just remove from tracking.
 */

import { Effect, Layer, Queue, ServiceMap, Stream } from 'effect';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { PanRpcError, TerminalOutput } from '@panopticon/contracts';

const execAsync = promisify(exec);

// ─── Runtime detection ────────────────────────────────────────────────────────

declare const Bun: unknown;
function isBun(): boolean {
  return typeof Bun !== 'undefined';
}

// ─── PTY process abstraction ──────────────────────────────────────────────────

interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): () => void;
  onExit(cb: (exitCode: number) => void): () => void;
}

// ─── Bun PTY wrapper ──────────────────────────────────────────────────────────

class BunPtyProcess implements PtyProcess {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(exitCode: number) => void>();
  private readonly decoder = new TextDecoder();
  private didExit = false;

  constructor(private readonly proc: { pid: number; exited: Promise<number>; signalCode?: number | null; terminal?: { write(d: string): void; resize?(c: number, r: number): void } }) {
    void proc.exited
      .then((code) => this.emitExit(Number.isInteger(code) ? code : 0))
      .catch(() => this.emitExit(1));
  }

  write(data: string): void {
    const t = (this.proc as { terminal?: { write(d: string): void } }).terminal;
    if (!t) throw new Error('Bun PTY terminal handle unavailable');
    t.write(data);
  }

  resize(cols: number, rows: number): void {
    const t = (this.proc as { terminal?: { resize?(c: number, r: number): void } }).terminal;
    if (!t?.resize) throw new Error('Bun PTY resize unavailable');
    t.resize(cols, rows);
  }

  onData(cb: (data: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => { this.dataListeners.delete(cb); };
  }

  onExit(cb: (exitCode: number) => void): () => void {
    this.exitListeners.add(cb);
    return () => { this.exitListeners.delete(cb); };
  }

  emitData(data: Uint8Array): void {
    if (this.didExit) return;
    const text = this.decoder.decode(data, { stream: true });
    if (text.length === 0) return;
    for (const l of this.dataListeners) l(text);
  }

  private emitExit(code: number): void {
    if (this.didExit) return;
    this.didExit = true;
    const remainder = this.decoder.decode();
    if (remainder.length > 0) {
      for (const l of this.dataListeners) l(remainder);
    }
    for (const l of this.exitListeners) l(code);
  }
}

// ─── Node PTY wrapper ─────────────────────────────────────────────────────────

class NodePtyProcess implements PtyProcess {
  constructor(private readonly proc: import('@homebridge/node-pty-prebuilt-multiarch').IPty) {}

  write(data: string): void { this.proc.write(data); }
  resize(cols: number, rows: number): void { this.proc.resize(cols, rows); }

  onData(cb: (data: string) => void): () => void {
    const d = this.proc.onData(cb);
    return () => { d.dispose(); };
  }

  onExit(cb: (exitCode: number) => void): () => void {
    const d = this.proc.onExit(({ exitCode }) => cb(exitCode));
    return () => { d.dispose(); };
  }
}

// ─── PTY spawn ────────────────────────────────────────────────────────────────

async function spawnPty(sessionName: string, cols: number, rows: number): Promise<PtyProcess> {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' } as Record<string, string>;
  const cwd = homedir();

  if (isBun()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BunGlobal = globalThis as any;
    let processHandle: BunPtyProcess | null = null;
    const subprocess = BunGlobal.Bun.spawn(['tmux', 'attach-session', '-t', sessionName], {
      cwd,
      env,
      terminal: {
        cols,
        rows,
        data: (_terminal: unknown, data: Uint8Array) => {
          processHandle?.emitData(data);
        },
      },
    });
    processHandle = new BunPtyProcess(subprocess);
    return processHandle;
  } else {
    const pty = await import('@homebridge/node-pty-prebuilt-multiarch');
    const proc = pty.spawn('tmux', ['attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
    return new NodePtyProcess(proc);
  }
}

// ─── Internal session state ───────────────────────────────────────────────────

interface TerminalSessionState {
  sessionName: string;
  ptyProcess: PtyProcess | null;
  ptyStarted: boolean;
  lastCols: number;
  lastRows: number;
  pendingInput: string[];
  /** Queue used by the Effect stream to receive terminal output chunks. */
  queue: Queue.Queue<TerminalOutput> | null;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface TerminalServiceShape {
  open(sessionName: string, cols: number, rows: number): Effect.Effect<{ sessionName: string }, PanRpcError>;
  write(sessionName: string, data: string): Effect.Effect<void, PanRpcError>;
  resize(sessionName: string, cols: number, rows: number): Effect.Effect<void, PanRpcError>;
  close(sessionName: string): Effect.Effect<void, PanRpcError>;
  streamSession(sessionName: string, cols: number, rows: number): Stream.Stream<TerminalOutput, PanRpcError>;
}

export class TerminalService extends ServiceMap.Service<TerminalService, TerminalServiceShape>()(
  'panopticon/dashboard/TerminalService',
) {}

// ─── Service implementation ───────────────────────────────────────────────────

export const TerminalServiceLive = Layer.effect(
  TerminalService,
  Effect.sync(() => {
    const sessions = new Map<string, TerminalSessionState>();

    /** Start the PTY for a session and wire up data/exit callbacks. */
    function startPty(state: TerminalSessionState, cols: number, rows: number): void {
      if (state.ptyStarted) return;
      state.ptyStarted = true;
      state.lastCols = cols;
      state.lastRows = rows;

      console.log(`[terminal-service] Spawning PTY for ${state.sessionName} at ${cols}x${rows}`);

      spawnPty(state.sessionName, cols, rows).then((proc) => {
        state.ptyProcess = proc;

        // Suppress initial stale burst ~200ms, then force repaint via dimension toggle.
        let forwarding = false;

        proc.onData((data) => {
          if (!forwarding) return;
          if (state.queue && !Queue.isShutdown(state.queue)) {
            Queue.offerUnsafe(state.queue, { sessionName: state.sessionName, data });
          }
        });

        setTimeout(() => {
          forwarding = true;
          // Dimension toggle: cols → cols-1 → cols (two SIGWINCHs, last at correct size).
          proc.resize(cols - 1, rows);
          execAsync(`tmux resize-window -t ${state.sessionName} -x ${cols - 1} -y ${rows} 2>/dev/null || true`)
            .then(() => new Promise<void>((r) => setTimeout(r, 50)))
            .then(() => {
              proc.resize(cols, rows);
              return execAsync(`tmux resize-window -t ${state.sessionName} -x ${cols} -y ${rows} 2>/dev/null || true`);
            })
            .catch(() => {/* ignore resize errors */});
        }, 200);

        proc.onExit((exitCode) => {
          console.log(`[terminal-service] PTY for ${state.sessionName} exited with code ${exitCode}`);
          if (state.queue && !Queue.isShutdown(state.queue)) {
            Queue.endUnsafe(state.queue);
          }
          sessions.delete(state.sessionName);
        });

        // Flush pending input that arrived before PTY was ready.
        for (const input of state.pendingInput) {
          proc.write(input);
        }
        state.pendingInput.length = 0;
      }).catch((err) => {
        console.error(`[terminal-service] Failed to spawn PTY for ${state.sessionName}:`, err);
        if (state.queue && !Queue.isShutdown(state.queue)) {
          Queue.endUnsafe(state.queue);
        }
        sessions.delete(state.sessionName);
      });
    }

    const open: TerminalServiceShape['open'] = (sessionName, cols, rows) =>
      Effect.gen(function* () {
        // Idempotent: reuse if already open.
        if (!sessions.has(sessionName)) {
          sessions.set(sessionName, {
            sessionName,
            ptyProcess: null,
            ptyStarted: false,
            lastCols: cols,
            lastRows: rows,
            pendingInput: [],
            queue: null,
          });
        }
        const state = sessions.get(sessionName)!;
        // Deferred spawn: startPty is called when the first resize arrives (or here if
        // cols/rows are already known from the open call). Per CLAUDE.md, both local
        // and remote handlers wait for the first resize message from the client. Since
        // the RPC protocol passes cols/rows in the open call we start immediately.
        if (!state.ptyStarted) {
          startPty(state, cols, rows);
        }
        return { sessionName };
      }).pipe(
        Effect.mapError((e) =>
          new PanRpcError({ message: `terminalOpen failed: ${String(e)}`, code: 'TERMINAL_ERROR' }),
        ),
      );

    const write: TerminalServiceShape['write'] = (sessionName, data) =>
      Effect.gen(function* () {
        const state = sessions.get(sessionName);
        if (!state) {
          return yield* Effect.fail(
            new PanRpcError({ message: `No terminal session: ${sessionName}`, code: 'TERMINAL_NOT_FOUND' }),
          );
        }
        if (state.ptyProcess) {
          state.ptyProcess.write(data);
        } else {
          state.pendingInput.push(data);
        }
      });

    const resize: TerminalServiceShape['resize'] = (sessionName, cols, rows) =>
      Effect.gen(function* () {
        const state = sessions.get(sessionName);
        if (!state) {
          return yield* Effect.fail(
            new PanRpcError({ message: `No terminal session: ${sessionName}`, code: 'TERMINAL_NOT_FOUND' }),
          );
        }
        // Deferred spawn: if PTY not yet started, start it now with the resize dimensions.
        if (!state.ptyStarted) {
          startPty(state, cols, rows);
          return;
        }
        // Ignore no-op resizes.
        if (cols === state.lastCols && rows === state.lastRows) return;
        state.lastCols = cols;
        state.lastRows = rows;
        if (state.ptyProcess) {
          state.ptyProcess.resize(cols, rows);
          yield* Effect.promise(() =>
            execAsync(`tmux resize-window -t ${sessionName} -x ${cols} -y ${rows} 2>/dev/null || true`).catch(() => {}),
          );
        }
      });

    const close: TerminalServiceShape['close'] = (sessionName) =>
      Effect.sync(() => {
        const state = sessions.get(sessionName);
        if (!state) return;
        // Do NOT kill the PTY — just remove from tracking. The PTY exits
        // naturally when pipes close; the tmux session survives independently.
        if (state.queue && !Queue.isShutdown(state.queue)) {
          Queue.endUnsafe(state.queue);
        }
        sessions.delete(sessionName);
      });

    const streamSession: TerminalServiceShape['streamSession'] = (sessionName, cols, rows) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Ensure session exists and PTY is starting.
          if (!sessions.has(sessionName)) {
            sessions.set(sessionName, {
              sessionName,
              ptyProcess: null,
              ptyStarted: false,
              lastCols: cols,
              lastRows: rows,
              pendingInput: [],
              queue: null,
            });
          }
          const state = sessions.get(sessionName)!;

          const outputStream = Stream.callback<TerminalOutput, PanRpcError>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                state.queue = queue;
                // Start PTY if not already started.
                if (!state.ptyStarted) {
                  startPty(state, cols, rows);
                }
              }),
              () =>
                Effect.sync(() => {
                  // On stream end, remove queue reference but do NOT kill PTY.
                  if (state.queue === queue) {
                    state.queue = null;
                  }
                }),
            ),
          );

          return outputStream;
        }),
      );

    return { open, write, resize, close, streamSession };
  }),
);
