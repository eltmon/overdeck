/**
 * Embedded dashboard server management.
 *
 * Spawns dist/dashboard/server.js (or the packaged equivalent) as a child
 * process, passing config via environment variables. Supports exponential-
 * backoff restart on crash. Graceful shutdown on app quit.
 *
 * Bootstrap config passed via env vars:
 *   PANOPTICON_PORT        — TCP port for HTTP + WS
 *   PANOPTICON_AUTH_TOKEN  — random hex token (future: auth middleware)
 *   PANOPTICON_MODE        — "desktop" (enables desktop-specific behaviours)
 *   PANOPTICON_NO_BROWSER  — "1" (suppresses auto browser open)
 */

import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";

import { resolveServerEntry } from "./main.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_PORT = 7825;
const MAX_RESTART_DELAY_MS = 30_000;
const SIGTERM_GRACE_MS = 3_000;

// ─── State ────────────────────────────────────────────────────────────────────

let serverProcess: ChildProcess.ChildProcess | null = null;
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;

// Callbacks so main.ts can react to server-ready / URL changes
let onReadyCallback: ((port: number, wsUrl: string) => void) | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  return Crypto.randomBytes(bytes).toString("hex");
}

function resolvePort(): number {
  // Each restart attempt increments the port to avoid EADDRINUSE during quick restarts
  return BASE_PORT + (restartAttempt % 10);
}

// ─── Start / Stop ─────────────────────────────────────────────────────────────

export function startServer(onReady: (port: number, wsUrl: string) => void): void {
  // Reset quit flag so manual restarts (after stopServer) can re-spawn.
  // The app-quit path sets isQuitting in main.ts before stopServer, so this
  // only un-latches the flag when the caller intends a real restart.
  quitting = false;
  onReadyCallback = onReady;
  spawnServer();
}

function spawnServer(): void {
  if (quitting) return;

  const entry = resolveServerEntry();
  if (!FS.existsSync(entry)) {
    console.error(`[desktop/server] Server entry not found: ${entry}`);
    console.error("[desktop/server] Run 'npm run build' to build the dashboard server first.");
    return;
  }

  const port = resolvePort();
  const authToken = randomHex(32);

  const child = ChildProcess.spawn(
    process.execPath,        // Node.js binary (same version Electron bundles)
    [entry],
    {
      env: {
        ...process.env,
        PANOPTICON_PORT: String(port),
        PANOPTICON_AUTH_TOKEN: authToken,
        PANOPTICON_MODE: "desktop",
        PANOPTICON_NO_BROWSER: "1",
        // Terminal settings for Claude Code / tmux rendering
        TERM: process.env.TERM || "xterm-256color",
        COLORTERM: process.env.COLORTERM || "truecolor",
        LANG: process.env.LANG || "en_US.UTF-8",
        // Strip env vars that would confuse the child
        ELECTRON_RUN_AS_NODE: undefined,
      } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  serverProcess = child;

  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  child.on("spawn", () => {
    console.log(`[desktop/server] spawned pid=${child.pid} port=${port}`);
    // Wait for server to be listening before signalling ready
    waitForServer(`http://127.0.0.1:${port}`, () => {
      console.log(`[desktop/server] ready on port ${port}`);
      onReadyCallback?.(port, `ws://127.0.0.1:${port}`);
    });
  });

  child.on("exit", (code, signal) => {
    serverProcess = null;
    console.warn(`[desktop/server] exited code=${String(code)} signal=${String(signal)}`);
    if (!quitting) {
      scheduleRestart();
    }
  });

  child.on("error", (err) => {
    console.error("[desktop/server] spawn error:", err);
    serverProcess = null;
    if (!quitting) scheduleRestart();
  });
}

function waitForServer(url: string, callback: () => void, maxMs = 30_000): void {
  const start = Date.now();
  const interval = setInterval(() => {
    if (Date.now() - start > maxMs) {
      clearInterval(interval);
      callback(); // call anyway — server might still come up
      return;
    }
    fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })
      .then((r) => {
        if (r.ok) {
          clearInterval(interval);
          callback();
        }
      })
      .catch(() => {
        /* not ready yet */
      });
  }, 500);
}

function scheduleRestart(): void {
  if (quitting) return;
  restartAttempt++;
  const delay = Math.min(1_000 * Math.pow(2, restartAttempt - 1), MAX_RESTART_DELAY_MS);
  console.log(`[desktop/server] restarting in ${delay}ms (attempt ${restartAttempt})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    spawnServer();
  }, delay);
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export function stopServer(): void {
  quitting = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = serverProcess;
  if (!child) return;

  serverProcess = null;
  child.kill("SIGTERM");

  // Force-kill if it doesn't exit within grace period
  const forceKill = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }, SIGTERM_GRACE_MS);
  forceKill.unref();
}
