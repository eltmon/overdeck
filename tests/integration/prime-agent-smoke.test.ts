import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrimeAgentRpcClient } from '../../src/lib/prime-agent/rpc-client.js';

const runLive = process.env.OVERDECK_PRIME_AGENT_LIVE === '1';
const provider = process.env.OVERDECK_PRIME_AGENT_PROVIDER ?? 'openai-codex';
const model = process.env.OVERDECK_PRIME_AGENT_MODEL ?? 'gpt-5.4-mini';

interface RunningPrimeAgent {
  child: ChildProcessWithoutNullStreams;
  client: PrimeAgentRpcClient;
  events: Record<string, unknown>[];
}

const children: ChildProcessWithoutNullStreams[] = [];

function launch(args: string[]): RunningPrimeAgent {
  const events: Record<string, unknown>[] = [];
  const child = spawn('prime-agent', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const client = new PrimeAgentRpcClient({
    stdin: child.stdin,
    requestTimeoutMs: 120_000,
    onEvent: event => events.push(event),
  });
  child.stdout.on('data', chunk => client.acceptStdout(chunk));
  child.once('error', error => client.close(error));
  child.once('exit', (code, signal) => client.close(new Error(`Prime Agent exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`)));
  return { child, client, events };
}

async function waitForEvent(session: RunningPrimeAgent, type: string, timeoutMs = 120_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const event = session.events.find(candidate => candidate.type === type);
    if (event) return event;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Prime Agent event ${type}`);
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
});

describe.skipIf(!runLive)('Prime Agent live RPC smoke', () => {
  it('launches, prompts, uses a tool, steers, reports cost, and resumes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-prime-agent-smoke-'));
    const sessions = join(root, 'sessions');
    const marker = join(root, 'prime-tool-ok.txt');
    const first = launch([
      '--mode', 'rpc', '--provider', provider, '--model', model,
      '--cwd', root, '--session-dir', sessions, '--no-context-files',
    ]);

    const initial = await first.client.request<{ sessionFile: string; isStreaming: boolean }>({ type: 'get_state' });
    expect(initial.data?.isStreaming).toBe(false);
    await first.client.request({
      type: 'prompt',
      message: `Use the bash tool to run: printf prime-tool-ok > ${marker}. Then reply with only TOOL_OK.`,
    });
    await first.client.request({ type: 'steer', message: 'Keep the final reply to exactly TOOL_OK.' });
    await waitForEvent(first, 'tool_execution_end');
    await waitForEvent(first, 'agent_end');

    expect(await readFile(marker, 'utf8')).toBe('prime-tool-ok');
    const stats = await first.client.request<{ cost: number; tokens: { total: number }; sessionFile: string }>({ type: 'get_session_stats' });
    expect(stats.data?.tokens.total).toBeGreaterThan(0);
    expect(stats.data?.cost).toBeGreaterThanOrEqual(0);
    expect(stats.data?.sessionFile).toBeTruthy();
    const sessionFile = stats.data!.sessionFile;
    await first.client.request({ type: 'abort' });
    first.child.kill('SIGTERM');

    const resumed = launch([
      '--mode', 'rpc', '--provider', provider, '--model', model,
      '--cwd', root, '--session-dir', sessions, '--resume', sessionFile,
      '--no-context-files',
    ]);
    const messages = await resumed.client.request<{ messages: unknown[] }>({ type: 'get_messages' });
    expect(messages.data?.messages.length).toBeGreaterThanOrEqual(2);
    const resumedState = await resumed.client.request<{ sessionFile: string }>({ type: 'get_state' });
    expect(resumedState.data?.sessionFile).toBe(sessionFile);
    await resumed.client.request({ type: 'abort' });
  }, 180_000);
});
