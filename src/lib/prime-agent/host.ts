import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { getAgentDir } from '../agents/agent-state.js';
import { getOverdeckHome } from '../paths.js';
import { PrimeAgentRpcClient } from './rpc-client.js';
import { resumePrimeAgentSession } from './session-resume.js';
import {
  PRIME_AGENT_HOST_MAX_CONCURRENT_REQUESTS,
  PrimeAgentHostRequestTooLarge,
  readPrimeAgentHostRequest,
} from './host-http.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1]!);
const required = (name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

interface RunningPrime {
  child: ChildProcessWithoutNullStreams;
  client: PrimeAgentRpcClient;
}

let cleanupFailedHost: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
  const agentId = required('--agent');
  const agentDir = getAgentDir(agentId);
  const socketDir = join(getOverdeckHome(), 'sockets');
  const socketPath = join(socketDir, `prime-agent-${agentId}.sock`);
  const token = randomBytes(32).toString('hex');
  const startupTimeoutMs = Number(required('--startup-timeout-ms'));
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs <= 0) throw new Error('Invalid --startup-timeout-ms');
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(socketDir, { recursive: true, mode: 0o700 });
  await rm(socketPath, { force: true });
  await writeFile(join(agentDir, 'prime-agent-token'), token, { mode: 0o600 });

  let lastEventAt = new Date().toISOString();
  let stats: unknown = null;
  let statsWrite: Promise<void> = Promise.resolve();
  let statsTimer: NodeJS.Timeout | undefined;
  let running: RunningPrime | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let stopped = false;
  const cleanup = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (statsTimer) clearTimeout(statsTimer);
    running?.client.close(new Error('Prime Agent host stopped'));
    running?.child.kill('SIGTERM');
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await rm(socketPath, { force: true });
  };
  cleanupFailedHost = cleanup;
  const stop = (): void => { void cleanup(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  const persistStats = (): Promise<void> => {
    statsWrite = statsWrite.then(() => writeFile(
      join(agentDir, 'prime-agent-stats.json'),
      JSON.stringify({ stats, lastEventAt }),
      { mode: 0o600 },
    ));
    return statsWrite;
  };
  const scheduleStatsWrite = (): void => {
    if (statsTimer) return;
    statsTimer = setTimeout(() => { statsTimer = undefined; void persistStats(); }, 250);
  };
  const refreshStats = async (): Promise<void> => {
    if (!running) return;
    const response = await running.client.request({ type: 'get_session_stats' });
    stats = response.data ?? null;
    await persistStats();
  };
  const launch = (resumePath?: string): RunningPrime => {
    const childArgs = ['--mode', 'rpc', '--provider', required('--provider'), '--model', required('--model'), '--session-dir', required('--session-dir'), '--append-system-prompt', required('--append-system-prompt')];
    if (resumePath) childArgs.push('--resume', resumePath);
    const child = spawn(required('--binary'), childArgs, { cwd: required('--workspace'), stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.pipe(process.stderr);
    const client = new PrimeAgentRpcClient({ stdin: child.stdin, requestTimeoutMs: startupTimeoutMs, onEvent: event => {
      lastEventAt = new Date().toISOString();
      scheduleStatsWrite();
      if (event.type === 'agent_end') void refreshStats().catch(() => undefined);
    } });
    child.once('error', error => client.close(new Error(`Prime Agent process failed to start: ${error.message}`)));
    child.stdout.on('data', chunk => client.acceptStdout(chunk));
    child.on('exit', code => client.close(new Error(`Prime Agent exited with code ${code ?? 'unknown'}`)));
    return { child, client };
  };

  const resume = args.get('--resume');
  if (resume) {
    await resumePrimeAgentSession({
      sessionId: resume,
      sessionPath: resume,
      start: async sessionPath => {
        running = launch(sessionPath);
        return {
          getState: async () => {
            const state = await running!.client.request<Record<string, unknown>>({ type: 'get_state' });
            return { sessionId: String(state.data?.sessionFile ?? state.data?.sessionId ?? '') };
          },
          stop: async () => { running!.child.kill('SIGTERM'); },
        };
      },
    });
  } else {
    running = launch();
  }
  const active = running;
  if (!active) throw new Error('Prime Agent process did not start');

  let activeRequests = 0;
  server = createServer((request, response) => {
    if (activeRequests >= PRIME_AGENT_HOST_MAX_CONCURRENT_REQUESTS) {
      response.writeHead(503, { connection: 'close' }).end('Prime Agent host is busy');
      return;
    }
    activeRequests += 1;
    void (async () => {
      if (request.headers['x-overdeck-bridge-token'] !== token) { response.writeHead(401).end(); return; }
      const body = await readPrimeAgentHostRequest(request, request.headers['content-length']) as { op: string; message?: string; preferred?: 'steer' | 'follow_up' };
      if (body.op === 'message') {
        const state = await active.client.request<{ isStreaming?: boolean }>({ type: 'get_state' });
        const type = state.data?.isStreaming ? (body.preferred ?? 'steer') : 'prompt';
        await active.client.request({ type, message: body.message ?? '' });
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ command: type }));
      } else if (body.op === 'abort') {
        await active.client.request({ type: 'abort' }); response.writeHead(204).end();
      } else if (body.op === 'stats') {
        await refreshStats(); response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ stats, lastEventAt }));
      } else { response.writeHead(400).end('unknown operation'); }
    })().catch(error => {
      const status = error instanceof PrimeAgentHostRequestTooLarge ? 413 : 500;
      response.writeHead(status, { connection: 'close' }).end(error instanceof Error ? error.message : String(error));
    }).finally(() => { activeRequests -= 1; });
  });

  try {
    await new Promise<void>((resolve, reject) => server!.listen(socketPath, resolve).once('error', reject));
    const state = await active.client.request<Record<string, unknown>>({ type: 'get_state' });
    const sessionId = String(state.data?.sessionFile ?? state.data?.sessionId ?? agentId);
    const promptFile = args.get('--prompt-file');
    const prompt = promptFile ? await readFile(promptFile, 'utf8') : args.get('--prompt');
    if (prompt) await active.client.request({ type: 'prompt', message: prompt });
    await refreshStats();
    const sessionPath = String(state.data?.sessionFile ?? state.data?.sessionPath ?? '');
    if (!sessionPath) throw new Error('Prime Agent did not report a durable session path');
    await writeFile(join(agentDir, 'prime-agent-session-path'), sessionPath, { mode: 0o600 });
    await writeFile(join(agentDir, 'prime-agent-session-id'), sessionId, { mode: 0o600 });
  } catch (error) {
    await cleanup();
    throw error;
  }
}

void main().catch(async error => {
  await cleanupFailedHost?.().catch(() => undefined);
  const agentId = args.get('--agent');
  if (agentId) {
    await mkdir(getAgentDir(agentId), { recursive: true, mode: 0o700 });
    await writeFile(join(getAgentDir(agentId), 'prime-agent-launch-error'), error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
