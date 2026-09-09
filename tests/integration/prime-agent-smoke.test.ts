import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPrimeAgentBaseCommand } from '../../src/lib/prime-agent/launch-command.js';
import { deliverPrimeAgentMessage, postPrimeAgentHost } from '../../src/lib/prime-agent/session-controller.js';
import { createPrimeAgentRuntimeSync } from '../../src/lib/runtimes/prime-agent.js';

const runLive = process.env.OVERDECK_PRIME_AGENT_LIVE === '1';
const model = process.env.OVERDECK_PRIME_AGENT_MODEL ?? 'gpt-5.4-mini';
const children: ChildProcess[] = [];

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Prime Agent production host');
}

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGTERM');
});

describe.skipIf(!runLive)('Prime Agent production-path smoke', () => {
  it('launches, delivers, uses a tool, reports cached stats, and resumes through the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-prime-agent-smoke-'));
    process.env.OVERDECK_HOME = root;
    const agentId = 'agent-prime-live-smoke';
    const marker = join(root, 'prime-tool-ok.txt');
    const command = await buildPrimeAgentBaseCommand({ agentId, model, workspace: root, authMode: 'api-key' });
    const first = spawn('bash', ['-lc', command], { stdio: 'inherit' });
    children.push(first);
    await waitUntil(() => createPrimeAgentRuntimeSync().isRunning(agentId));
    await deliverPrimeAgentMessage(agentId, `Use the bash tool to run: printf prime-tool-ok > ${marker}. Then reply with only TOOL_OK.`);
    await deliverPrimeAgentMessage(agentId, 'Keep the final reply to exactly TOOL_OK.', 'steer');
    await waitUntil(async () => await readFile(marker, 'utf8').then(value => value === 'prime-tool-ok').catch(() => false));
    await postPrimeAgentHost(agentId, { op: 'stats' });
    const runtime = createPrimeAgentRuntimeSync();
    expect(runtime.getTokenUsage(agentId)?.inputTokens).toBeGreaterThan(0);
    const sessionId = await readFile(join(root, 'agents', agentId, 'prime-agent-session-id'), 'utf8');
    first.kill('SIGTERM');

    const resumed = spawn('bash', ['-lc', `${command} --resume '${sessionId.trim()}'`], { stdio: 'inherit' });
    children.push(resumed);
    await waitUntil(() => createPrimeAgentRuntimeSync().isRunning(agentId));
    await deliverPrimeAgentMessage(agentId, 'Reply with only RESUMED.');
    await postPrimeAgentHost(agentId, { op: 'stats' });
    expect(runtime.getSessionPath(agentId)).toBeTruthy();
  }, 180_000);
});
