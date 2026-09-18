/**
 * Prime Agent live production-path smoke (PAN-3668).
 *
 * This suite drives a real `prime-agent` binary against a real provider, so it
 * lives in the opt-in slow lane: `vitest.config.ts` excludes every
 * `*.slow.test.ts` file from `npm test`, from CI, and from the verification
 * gate unless `VITEST_INCLUDE_SLOW=1` is set. It carries no `.skip`/`.skipIf`:
 * an enabled run that is missing its prerequisites fails loudly with an
 * actionable error instead of reporting a silent pass.
 *
 * Run it with:
 *   VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/prime-agent-smoke.slow.test.ts
 *
 * Prerequisites: a `prime-agent` binary on PATH (or a configured executable
 * path) and provider credentials for the selected model. Override the model
 * with `OVERDECK_PRIME_AGENT_MODEL`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requireHarnessBinary } from '../../src/lib/harness-binary.js';
import { buildPrimeAgentBaseCommand } from '../../src/lib/prime-agent/launch-command.js';
import { deliverPrimeAgentMessage, postPrimeAgentHost } from '../../src/lib/prime-agent/session-controller.js';
import { createPrimeAgentRuntimeSync } from '../../src/lib/runtimes/prime-agent.js';

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

beforeAll(async () => {
  // Fail fast with the installation guidance instead of spawning a shell that
  // never produces a host and timing out 120s later inside waitUntil().
  await requireHarnessBinary('prime-agent');
});

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGTERM');
});

describe('Prime Agent production-path smoke', () => {
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
