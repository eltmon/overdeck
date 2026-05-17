/**
 * Panopticon Supervisor — small external watchdog that survives dashboard crashes.
 *
 * The dashboard's own POST /api/system/restart-dashboard endpoint cannot help
 * if the dashboard process is fully dead, because the request can't reach it.
 * The supervisor runs as a sidecar process on a separate port so the browser
 * still has somewhere to send the "Force Restart" request when the dashboard
 * has crashed.
 *
 * Endpoints:
 *   GET  /health             → 200 OK; lightweight liveness probe
 *   GET  /status             → current dashboard watchdog state
 *   POST /restart-dashboard  → 202 Accepted; spawns `pan restart --dashboard`
 *
 * Started by `pan up` via `startSupervisorProcess()` in `src/lib/supervisor.ts`.
 * Stopped by `pan down`. Independent of the dashboard's own lifecycle.
 */

import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { acquireRestartLock, readRestartLockHolder, type RestartLockHandle } from '../lib/restart-lock.js';
import { readPlatformConfig } from '../lib/platform-lifecycle.js';
import { readWatchdogConfig, SupervisorWatchdog, type SpawnRestartResult } from './watchdog.js';

const SUPERVISOR_PORT = Number(process.env.PANOPTICON_SUPERVISOR_PORT || 3012);
const PAN_BINARY = process.env.PANOPTICON_PAN_BINARY || 'pan';
const LOG_FILE = path.join(os.homedir(), '.panopticon', 'logs', 'supervisor.log');
const platformConfig = readPlatformConfig();
const watchdogConfig = readWatchdogConfig(process.env, platformConfig.dashboardApiPort);

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // best-effort logging
  }
}

function allowedOrigin(req: http.IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return null;
  const allowed = new Set([
    `http://localhost:${platformConfig.dashboardPort}`,
    `http://127.0.0.1:${platformConfig.dashboardPort}`,
    `https://${platformConfig.traefikDomain}`,
  ]);
  return allowed.has(origin) ? origin : null;
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = allowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function sendJson(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  applyCors(req, res);
  res.end(JSON.stringify(body));
}

function heldRestartMessage(): string {
  const holder = readRestartLockHolder();
  const heldBy = holder ? `held by PID ${holder.pid} (${holder.caller})` : 'held by another process';
  return `restart in progress (${heldBy})`;
}

async function spawnRestart(options: { restartLockHeld?: boolean } = {}): Promise<SpawnRestartResult> {
  let lock: RestartLockHandle | null = null;
  if (!options.restartLockHeld) {
    lock = acquireRestartLock('supervisor restart');
    if (!lock) return { pid: null, error: heldRestartMessage() };
  }

  const release = () => {
    lock?.release();
    lock = null;
  };

  try {
    const child = spawn(PAN_BINARY, ['restart', '--dashboard'], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PANOPTICON_RESTART_LOCK_HELD: '1',
        PANOPTICON_SKIP_SUPERVISOR_CYCLE: '1',
      },
    });

    let spawnErrorMessage: string | null = null;
    const done = new Promise<void>((resolve, reject) => {
      child.once('error', (err) => {
        spawnErrorMessage = err.message;
        log(`spawn error: ${err.message}`);
        release();
        reject(err);
      });
      child.once('close', (code, signal) => {
        release();
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`pan restart --dashboard exited ${code ?? `via signal ${signal ?? 'unknown'}`}`));
      });
    });
    done.catch(() => {});

    await new Promise((resolve) => setImmediate(resolve));
    if (spawnErrorMessage) return { pid: null, error: spawnErrorMessage };
    child.unref();
    return { pid: child.pid ?? null, error: null, done };
  } catch (err) {
    release();
    const msg = err instanceof Error ? err.message : String(err);
    return { pid: null, error: msg };
  }
}

const watchdog = new SupervisorWatchdog({
  config: watchdogConfig,
  spawnRestart,
  log,
});

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    applyCors(req, res);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(req, res, 200, { ok: true, port: SUPERVISOR_PORT });
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    sendJson(req, res, 200, watchdog.status());
    return;
  }

  if (req.method === 'POST' && req.url === '/restart-dashboard') {
    void (async () => {
      log('received restart-dashboard request');
      const result = await spawnRestart();
      if (result.error) {
        sendJson(req, res, 500, { error: result.error });
        return;
      }
      sendJson(req, res, 202, { ok: true, pid: result.pid });
    })();
    return;
  }

  sendJson(req, res, 404, { error: 'not found' });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log(`port ${SUPERVISOR_PORT} already in use — supervisor exiting`);
    process.exit(2);
  }
  log(`server error: ${err.message}`);
  process.exit(1);
});

server.listen(SUPERVISOR_PORT, '127.0.0.1', () => {
  log(`supervisor listening on http://127.0.0.1:${SUPERVISOR_PORT}`);
  if (watchdogConfig.enabled) {
    watchdog.start();
    log(`watchdog polling http://127.0.0.1:${watchdogConfig.dashboardApiPort}/api/health every ${watchdogConfig.pollMs}ms`);
  } else {
    log('watchdog disabled by PANOPTICON_SUPERVISOR_WATCHDOG=0');
  }
});

const shutdown = (): void => {
  watchdog.stop();
  log('shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
