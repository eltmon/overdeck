#!/usr/bin/env node
/**
 * PTY supervisor for orchestrator delivery.
 *
 * This process must run under Node 22, not Bun: it owns the node-pty master fd
 * for the child Claude Code process, and Bun's native-addon compatibility layer
 * is known to make this PTY exit immediately. Because the supervisor owns the
 * PTY, a supervisor crash terminates the child session; Deacon resume should
 * recreate the launcher and supervisor just like a fresh spawn.
 *
 * The launcher runs `node dist/pty-supervisor.js claude ...` with TERM,
 * COLORTERM, LANG, PATH, NODE_EXTRA_CA_CERTS, and the rest of process.env
 * passed through unchanged. The supervisor proxies stdin/stdout/resize between
 * tmux and Claude, and listens on `${PANOPTICON_HOME}/sockets/pty-<agentId>.sock`
 * for authenticated HTTP-on-unix POSTs. Socket-injected messages echo to stdout
 * by default so the tmux transcript shows what Cloister sent. Permission relay
 * is intentionally out of scope; existing Channels MCP remains the bidirectional
 * permission path for agents that opt into it.
 */

import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { getPanopticonHome } from '../paths.js';
import { PTY_TOKEN_HEADER, readPtyTokenSync } from '../pty-token.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const SHUTDOWN_GRACE_MS = 2_000;
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface PtySupervisorPayload {
  content: string;
  echo?: boolean;
  caller?: string;
  meta?: Record<string, string>;
}

export function getPtySupervisorSocketPath(agentId: string): string {
  return join(getPanopticonHome(), 'sockets', `pty-${agentId}.sock`);
}

export function getPtySupervisorLogPath(agentId: string): string {
  return join(getPanopticonHome(), 'logs', `pty-supervisor-${agentId}.log`);
}

function resolveAgentIdOrExit(): string {
  const agentId = process.env.PANOPTICON_AGENT_ID;
  if (!agentId) {
    process.stderr.write(
      'pty-supervisor: PANOPTICON_AGENT_ID env var is required. It is normally supplied by the launcher.\n',
    );
    process.exit(2);
  }
  return agentId;
}

function resolveChildCommandOrExit(): { command: string; args: string[] } {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    process.stderr.write('pty-supervisor: child command is required. Example: node dist/pty-supervisor.js claude\n');
    process.exit(2);
  }
  return { command, args };
}

function constantTimeHeaderMatch(provided: string | string[] | undefined, expected: string): boolean {
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value) return false;
  const providedBuffer = Buffer.from(value, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function validatePtyToken(req: IncomingMessage, agentId: string): boolean {
  const expected = readPtyTokenSync(agentId);
  if (!expected) return false;
  return constantTimeHeaderMatch(req.headers[PTY_TOKEN_HEADER], expected);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > MAX_REQUEST_BYTES) {
      throw new Error('request body too large');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text || '{}');
}

function parsePayload(value: unknown): PtySupervisorPayload | null {
  if (value === null || typeof value !== 'object') return null;
  const payload = value as Partial<PtySupervisorPayload>;
  if (typeof payload.content !== 'string' || payload.content.length === 0) return null;
  if (payload.echo !== undefined && typeof payload.echo !== 'boolean') return null;
  if (payload.caller !== undefined && typeof payload.caller !== 'string') return null;
  if (payload.meta !== undefined) {
    if (payload.meta === null || typeof payload.meta !== 'object' || Array.isArray(payload.meta)) return null;
    for (const [key, metaValue] of Object.entries(payload.meta)) {
      if (typeof key !== 'string' || typeof metaValue !== 'string') return null;
    }
  }
  return payload as PtySupervisorPayload;
}

function payloadCaller(payload: PtySupervisorPayload): string | undefined {
  return payload.caller ?? payload.meta?.caller;
}

async function appendSocketWriteLog(agentId: string, payload: PtySupervisorPayload): Promise<void> {
  try {
    const logPath = getPtySupervisorLogPath(agentId);
    await mkdir(join(getPanopticonHome(), 'logs'), { recursive: true, mode: 0o700 });
    const caller = payloadCaller(payload);
    await appendFile(
      logPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        agentId,
        kind: 'socket_write',
        contentLength: payload.content.length,
        ...(caller ? { caller } : {}),
      })}\n`,
      'utf8',
    );
  } catch {
    // non-critical
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
  });
  res.end(encoded);
}

export async function injectPtyMessage(
  child: pty.IPty,
  agentId: string,
  payload: PtySupervisorPayload,
): Promise<void> {
  const content = payload.content.endsWith('\n') ? payload.content : `${payload.content}\n`;
  child.write(content);
  if (payload.echo !== false) {
    process.stdout.write(content);
  }
  await appendSocketWriteLog(agentId, payload);
}

export function createPtySupervisorServer(agentId: string, child: pty.IPty): Server {
  return createServer(async (req, res) => {
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method not allowed' });
      return;
    }
    if (!validatePtyToken(req, agentId)) {
      writeJson(res, 403, { error: 'forbidden' });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : 'invalid json' });
      return;
    }

    const payload = parsePayload(body);
    if (!payload) {
      writeJson(res, 400, { error: 'content is required and must be a non-empty string' });
      return;
    }

    await injectPtyMessage(child, agentId, payload);
    writeJson(res, 200, 'ok');
  });
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    if (existsSync(path)) await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
}

function waitForServerClose(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function bindSocket(server: Server, socketPath: string): Promise<void> {
  await mkdir(join(getPanopticonHome(), 'sockets'), { recursive: true, mode: 0o700 });
  await unlinkIfExists(socketPath);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
  await chmod(socketPath, 0o600);
}

function stdoutDimensions(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || DEFAULT_COLS,
    rows: process.stdout.rows || DEFAULT_ROWS,
  };
}

function proxyPtyToStdout(child: pty.IPty): void {
  child.onData((data) => {
    if (process.stdout.write(data)) return;
    child.pause();
    process.stdout.once('drain', () => child.resume());
  });
}

function proxyStdinToPty(child: pty.IPty): void {
  process.stdin.on('data', (chunk) => child.write(chunk.toString()));
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
}

function proxyResizeToPty(child: pty.IPty): void {
  const resize = () => {
    const { cols, rows } = stdoutDimensions();
    child.resize(cols, rows);
  };
  process.stdout.on('resize', resize);
}

async function main(): Promise<void> {
  const agentId = resolveAgentIdOrExit();
  const { command, args } = resolveChildCommandOrExit();
  const { cols, rows } = stdoutDimensions();
  const child = pty.spawn(command, args, {
    name: process.env.TERM || 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  proxyPtyToStdout(child);
  proxyStdinToPty(child);
  proxyResizeToPty(child);

  const socketPath = getPtySupervisorSocketPath(agentId);
  const server = createPtySupervisorServer(agentId, child);
  let shuttingDown = false;

  const childExited = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
    child.onExit(resolve);
  });

  const cleanup = async () => {
    await waitForServerClose(server).catch(() => undefined);
    await unlinkIfExists(socketPath).catch(() => undefined);
  };

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // child already exited
    }
    await Promise.race([
      childExited,
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);
    await cleanup();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await bindSocket(server, socketPath);

  const result = await childExited;
  if (shuttingDown) return;
  shuttingDown = true;
  await cleanup();
  process.exit(result.exitCode ?? (result.signal ? 128 + result.signal : 0));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  void main().catch((error) => {
    process.stderr.write(`pty-supervisor: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
