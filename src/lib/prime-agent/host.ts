import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { getAgentDir } from '../agents/agent-state.js';
import { getOverdeckHome } from '../paths.js';
import { PrimeAgentRpcClient } from './rpc-client.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1]!);
const required = (name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const agentId = required('--agent');
const agentDir = getAgentDir(agentId);
const socketDir = join(getOverdeckHome(), 'sockets');
const socketPath = join(socketDir, `prime-agent-${agentId}.sock`);
const token = randomBytes(32).toString('hex');
mkdirSync(agentDir, { recursive: true, mode: 0o700 });
mkdirSync(socketDir, { recursive: true, mode: 0o700 });
rmSync(socketPath, { force: true });
writeFileSync(join(agentDir, 'prime-agent-token'), token, { mode: 0o600 });

const childArgs = ['--mode', 'rpc', '--provider', required('--provider'), '--model', required('--model'), '--session-dir', required('--session-dir'), '--append-system-prompt', required('--append-system-prompt')];
const resume = args.get('--resume');
if (resume) childArgs.push('--resume', resume);
let lastEventAt = new Date().toISOString();
let stats: unknown = null;
const child = spawn(required('--binary'), childArgs, { cwd: required('--workspace'), stdio: ['pipe', 'pipe', 'inherit'] });
const client = new PrimeAgentRpcClient({ stdin: child.stdin, onEvent: event => {
  lastEventAt = new Date().toISOString();
  writeFileSync(join(agentDir, 'prime-agent-stats.json'), JSON.stringify({ stats, lastEventAt }), { mode: 0o600 });
  if (event.type === 'agent_end') void refreshStats().catch(() => undefined);
} });
child.stdout.on('data', chunk => client.acceptStdout(chunk));
child.on('exit', code => client.close(new Error(`Prime Agent exited with code ${code ?? 'unknown'}`)));

async function refreshStats(): Promise<void> {
  const response = await client.request({ type: 'get_session_stats' });
  stats = response.data ?? null;
  writeFileSync(join(agentDir, 'prime-agent-stats.json'), JSON.stringify({ stats, lastEventAt }), { mode: 0o600 });
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.headers['x-overdeck-bridge-token'] !== token) { response.writeHead(401).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { op: string; message?: string; preferred?: 'steer' | 'follow_up' };
    if (body.op === 'message') {
      const state = await client.request<{ isStreaming?: boolean }>({ type: 'get_state' });
      const type = state.data?.isStreaming ? (body.preferred ?? 'steer') : 'prompt';
      await client.request({ type, message: body.message ?? '' });
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ command: type }));
    } else if (body.op === 'abort') {
      await client.request({ type: 'abort' }); response.writeHead(204).end();
    } else if (body.op === 'stats') {
      await refreshStats(); response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ stats, lastEventAt }));
    } else { response.writeHead(400).end('unknown operation'); }
  })().catch(error => response.writeHead(500).end(error instanceof Error ? error.message : String(error)));
});

server.listen(socketPath, async () => {
  try {
    const state = await client.request<Record<string, unknown>>({ type: 'get_state' });
    const sessionId = String(state.data?.sessionFile ?? state.data?.sessionId ?? resume ?? agentId);
    writeFileSync(join(agentDir, 'prime-agent-session-id'), sessionId, { mode: 0o600 });
    writeFileSync(join(agentDir, 'prime-agent-session-path'), required('--session-dir'), { mode: 0o600 });
    const promptFile = args.get('--prompt-file');
    const prompt = promptFile ? readFileSync(promptFile, 'utf8') : args.get('--prompt');
    if (prompt) await client.request({ type: 'prompt', message: prompt });
    await refreshStats();
  } catch (error) {
    writeFileSync(join(agentDir, 'prime-agent-launch-error'), error instanceof Error ? error.message : String(error));
  }
});

const stop = (): void => { child.kill('SIGTERM'); server.close(); rmSync(socketPath, { force: true }); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
