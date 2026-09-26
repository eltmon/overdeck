/**
 * @slow PAN-3668 WI-23 (NFR-7): live Prime Agent smoke test against the installed
 * binary. Excluded from the default run (`*.slow.test.ts`); run it with
 *   VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/prime-agent-smoke.slow.test.ts
 * It skips when `prime-agent` is not installed or no credential resolves for the model
 * (override with PRIME_AGENT_SMOKE_MODEL / PRIME_AGENT_SMOKE_AUTH, default gpt-5.5 on the
 * openai subscription). It spends a few model tokens.
 *
 * Flow: launch a host for a throwaway agent in a temp git repo, prompt, steer while the
 * turn is streaming, read stats, stop, check that `prime-agent status --json` has no
 * supervisor on the agent's socket, resume, and check that the session id is unchanged.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveHarnessBinary } from '../../src/lib/harness-binary.js';
import { findPrimeAgentSupervisor } from '../../src/lib/prime-agent/daemon.js';
import { postPrimeAgentHostOp } from '../../src/lib/prime-agent/host-client.js';
import { startPrimeAgentHost, type PrimeAgentHost } from '../../src/lib/prime-agent/host.js';
import { resolvePrimeAgentCredential } from '../../src/lib/prime-agent/provider-map.js';
import { primeAgentAuthFilePath, primeAgentDaemonSocketPath } from '../../src/lib/runtimes/storage/prime-agent.js';

const execFileAsync = promisify(execFile);
const MODEL = process.env.PRIME_AGENT_SMOKE_MODEL ?? 'gpt-5.5';
const AUTH = (process.env.PRIME_AGENT_SMOKE_AUTH ?? 'subscription') as 'subscription' | 'api-key';
const AGENT_ID = 'agent-prime-smoke';

// The test setup isolates HOME; Prime's sign-in lives in the real account home.
const REAL_HOME = userInfo().homedir;
const binary = await resolveHarnessBinary('prime-agent');
const credential = binary
  ? await resolvePrimeAgentCredential(MODEL, AUTH, { authFile: primeAgentAuthFilePath(REAL_HOME) }).catch(() => null)
  : null;

async function until<T>(read: () => Promise<T | null | undefined> | T | null | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
}

async function status(home: string): Promise<{ isStreaming: boolean; sessionId: string }> {
  const response = await postPrimeAgentHostOp(AGENT_ID, { op: 'status' }, 5_000, home);
  return JSON.parse(response.body) as { isStreaming: boolean; sessionId: string };
}

describe.skipIf(!binary || !credential)('Prime Agent live smoke (PAN-3668 WI-23)', () => {
  let home: string;
  let workspace: string;
  let prevHome: string | undefined;
  let prevUserHome: string | undefined;
  let host: PrimeAgentHost | undefined;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'pps-'));
    prevHome = process.env.OVERDECK_HOME;
    prevUserHome = process.env.HOME;
    process.env.OVERDECK_HOME = home;
    process.env.HOME = REAL_HOME; // the Prime child reads ~/.prime/agent/auth.json
    for (const [key, value] of Object.entries(credential!.envExports)) process.env[key] = value;
    workspace = join(home, 'ws');
    mkdirSync(workspace, { recursive: true });
    await execFileAsync('git', ['init', '-q', workspace]);
  });

  afterAll(async () => {
    await host?.stop();
    if (prevHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevHome;
    if (prevUserHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevUserHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('prompts, steers, reports stats, stops without a leftover daemon, and resumes the same session', async () => {
    const options = { agentId: AGENT_ID, binaryPath: binary!, workspace, provider: credential!.provider, model: MODEL, overdeckHome: home };
    host = await startPrimeAgentHost(options);
    const sessionId = host.currentSessionId;
    const sessionFile = host.currentSessionFile;
    expect(sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(sessionFile).toContain('/prime-sessions/');

    const first = await postPrimeAgentHostOp(AGENT_ID, {
      op: 'message',
      content: 'Use your bash tool to run `sleep 4`, then reply with the single word ok.',
    }, 10_000, home);
    expect(JSON.parse(first.body)).toMatchObject({ accepted: true, command: 'prompt' });

    await until(async () => (await status(home)).isStreaming, 60_000, 'the turn to start streaming');
    const steer = await postPrimeAgentHostOp(AGENT_ID, { op: 'message', content: 'After that, also reply with the word done.' }, 10_000, home);
    expect(JSON.parse(steer.body)).toMatchObject({ accepted: true, command: 'steer' });

    const statsFile = join(home, 'agents', AGENT_ID, 'prime-agent-stats.json');
    const stats = await until(() => {
      if (!existsSync(statsFile)) return null;
      const snapshot = JSON.parse(readFileSync(statsFile, 'utf8')) as { stats: { tokens?: { total?: number } } | null };
      return snapshot.stats?.tokens?.total ? snapshot.stats : null;
    }, 180_000, 'session stats after the turn');
    expect(stats.tokens?.total).toBeGreaterThan(0);
    await until(async () => !(await status(home)).isStreaming, 180_000, 'the turn to finish');

    await host.stop();
    host = undefined;
    const socket = primeAgentDaemonSocketPath(AGENT_ID, home);
    await expect(findPrimeAgentSupervisor(binary!, socket)).resolves.toBeNull();

    host = await startPrimeAgentHost({ ...options, resumeSessionFile: sessionFile });
    expect(host.currentSessionId).toBe(sessionId);
    expect(host.currentSessionFile).toBe(sessionFile);
    await host.stop();
    host = undefined;
    await expect(findPrimeAgentSupervisor(binary!, socket)).resolves.toBeNull();
  }, 420_000);
});
