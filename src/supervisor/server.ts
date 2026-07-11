/**
 * Overdeck Supervisor — small external watchdog that survives dashboard crashes.
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

import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { readPlatformConfigSync } from '../lib/platform-lifecycle.js';
import { readWatchdogConfig, SupervisorWatchdog } from './watchdog.js';
import { createSupervisorRestartSpawner, resolveBundledPanInvocation } from './restart-spawn.js';
import { readTtsWatchdogConfig, TtsWatchdog } from './tts-watchdog.js';

const SUPERVISOR_PORT = Number(process.env.OVERDECK_SUPERVISOR_PORT || 3012);
const PAN_INVOCATION = process.env.OVERDECK_PAN_BINARY
  ? { panBinary: process.env.OVERDECK_PAN_BINARY, panArgsPrefix: [] }
  : resolveBundledPanInvocation();
const LOG_FILE = path.join(os.homedir(), '.overdeck', 'logs', 'supervisor.log');
const platformConfig = readPlatformConfigSync();
const watchdogConfig = readWatchdogConfig(process.env, platformConfig.dashboardApiPort);
const ttsWatchdogConfig = readTtsWatchdogConfig(process.env);

async function log(msg: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    await appendFile(LOG_FILE, line);
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

const spawnRestart = createSupervisorRestartSpawner({ ...PAN_INVOCATION, log });

const watchdog = new SupervisorWatchdog({
  config: watchdogConfig,
  spawnRestart,
  log,
});
const ttsWatchdog = new TtsWatchdog({
  config: ttsWatchdogConfig,
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

  if (req.method === 'GET' && req.url === '/tts-status') {
    sendJson(req, res, 200, ttsWatchdog.status());
    return;
  }

  if (req.method === 'POST' && req.url === '/restart-dashboard') {
    void (async () => {
      await log('received restart-dashboard request');
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
    void log(`port ${SUPERVISOR_PORT} already in use — supervisor exiting`).finally(() => process.exit(2));
    return;
  }
  void log(`server error: ${err.message}`).finally(() => process.exit(1));
});

server.listen(SUPERVISOR_PORT, '127.0.0.1', () => {
  void (async () => {
    await log(`supervisor listening on http://127.0.0.1:${SUPERVISOR_PORT}`);
    if (watchdogConfig.enabled) {
      watchdog.start();
      await log(`watchdog polling http://127.0.0.1:${watchdogConfig.dashboardApiPort}/api/health every ${watchdogConfig.pollMs}ms`);
    } else {
      await log('watchdog disabled by OVERDECK_SUPERVISOR_WATCHDOG=0');
    }
    if (ttsWatchdogConfig.enabled) {
      ttsWatchdog.start();
      await log(`tts watchdog polling every ${ttsWatchdogConfig.pollMs}ms`);
    } else {
      await log('tts watchdog disabled by OVERDECK_TTS_WATCHDOG=0');
    }
  })();
});

const shutdown = (): void => {
  watchdog.stop();
  ttsWatchdog.stop();
  void (async () => {
    await log('shutting down');
    server.close(() => process.exit(0));
  })();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
