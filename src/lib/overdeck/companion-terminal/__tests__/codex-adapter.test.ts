/**
 * PAN-3835 — the Codex companion adapter resolves `codex resume --remote` for
 * the conversation's own app-server and thread, from the host's live answer
 * and server-side records only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HostOpOutcome } from '../../../codex/app-server-client.js';
import { createCodexCompanionAdapter, CODEX_RESTART_REQUIRED_MESSAGE } from '../codex-adapter.js';
import type { CompanionOwner } from '../lifecycle.js';

const OWNER: CompanionOwner = {
  conversationName: '20260923-0002',
  ownerSession: 'conv-20260923-0002',
  cwd: '/work/repo',
  harness: 'codex',
};
const AGENT_DIR = '/home/op/.overdeck/agents/conv-20260923-0002';
const ENDPOINT = `unix://${AGENT_DIR}/codex-native/app.sock`;
const THREAD = '01a0cf2b-92d3-7260-9919-e020c0c91104';
const GENERATION = '6f1c2f0e-3f55-4a3e-9d8e-2b0c1f5e7a10';

function ok(status: number, body: Record<string, unknown>): HostOpOutcome {
  return { ok: true, response: { status, body } };
}

const READY = ok(200, { ok: true, threadId: THREAD, endpoint: ENDPOINT, generation: GENERATION, navigationEpoch: 0 });

function adapterWith(outcome: HostOpOutcome, options: {
  files?: Record<string, string>;
  binary?: string | null;
  codexHomeExists?: boolean;
  transport?: string;
} = {}) {
  const files = options.files ?? { [`${AGENT_DIR}/codex-native-endpoint`]: `${ENDPOINT}\n` };
  const postHostOp = vi.fn(async () => outcome);
  const readText = vi.fn(async (path: string) => files[path]);
  const resolveBinary = vi.fn(async () => (options.binary === undefined ? '/usr/local/bin/codex' : options.binary));
  const adapter = createCodexCompanionAdapter({
    overdeckHome: () => '/home/op/.overdeck',
    postHostOp,
    readText,
    resolveBinary,
    pathExists: async () => options.codexHomeExists ?? true,
    codexTransport: () => options.transport,
  });
  return { adapter, postHostOp, resolveBinary };
}

describe('Codex companion adapter', () => {
  it('attaches the native TUI to the conversation endpoint and exact thread', async () => {
    const { adapter, postHostOp } = adapterWith(READY);

    const target = await adapter.resolveTarget(OWNER);

    expect(postHostOp).toHaveBeenCalledWith('conv-20260923-0002', { op: 'prepare-terminal' });
    expect(target).toEqual({
      ok: true,
      argv: ['/usr/local/bin/codex', 'resume', '-c', 'check_for_update_on_startup=false', '--remote', ENDPOINT, THREAD],
      cwd: '/work/repo',
      env: { CODEX_HOME: `${AGENT_DIR}/codex-home-v2` },
      fingerprint: `${GENERATION}:${THREAD}:0`,
    });
  });

  it('never passes model, sandbox, or approval flags that would change the thread on attach', async () => {
    const { adapter } = adapterWith(READY);
    const target = await adapter.resolveTarget(OWNER);
    expect(target.ok && target.argv.some(arg => ['-m', '--model', '-s', '--sandbox', '-a', '--ask-for-approval'].includes(arg))).toBe(false);
  });

  it('moves the fingerprint when the attached TUI navigated to another thread', async () => {
    const { adapter } = adapterWith(ok(200, { ok: true, threadId: THREAD, endpoint: ENDPOINT, generation: GENERATION, navigationEpoch: 2 }));
    const target = await adapter.resolveTarget(OWNER);
    expect(target.ok && target.fingerprint).toBe(`${GENERATION}:${THREAD}:2`);
  });

  it('reports restart-required for a host from before the native endpoint (old_host_is_not_restarted)', async () => {
    const { adapter, postHostOp } = adapterWith(ok(400, { error: 'unsupported app-server op: prepare-terminal' }), { files: {} });

    expect(await adapter.resolveTarget(OWNER)).toEqual({
      ok: false,
      reason: 'restart-required',
      message: CODEX_RESTART_REQUIRED_MESSAGE,
    });
    // Only the read-only-for-old-hosts probe ran; nothing restarts anything.
    expect(postHostOp).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not-requested', 'restart-required'],
    ['connect-failed', 'restart-required'],
    ['cli-unsupported', 'cli-unsupported'],
    ['socket-path-too-long', 'unsupported'],
  ])('maps a host without a native endpoint (%s) to %s', async (hostReason, reason) => {
    const { adapter } = adapterWith(ok(422, { code: 'native-unavailable', reason: hostReason, cliVersion: '0.150.0' }), { files: {} });
    const target = await adapter.resolveTarget(OWNER);
    expect(target).toMatchObject({ ok: false, reason });
    if (reason === 'cli-unsupported') expect(target.ok ? '' : target.message).toMatch(/0\.153\.4 or newer \(installed: 0\.150\.0\)/);
  });

  it('asks for a first message when the conversation has no saved turn yet', async () => {
    const { adapter } = adapterWith(ok(409, { code: 'no-thread', error: 'the conversation has no Codex thread yet' }));
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'session-not-started' });
  });

  it('reports a saved thread Codex cannot reopen without creating a new one', async () => {
    const { adapter } = adapterWith(ok(409, { code: 'resume-failed', error: 'no rollout found' }));
    const target = await adapter.resolveTarget(OWNER);
    expect(target).toMatchObject({ ok: false, reason: 'session-missing' });
    expect(target.ok ? '' : target.message).toMatch(/no new thread was created/);
  });

  it('treats an unreachable host as starting', async () => {
    const { adapter } = adapterWith({ ok: false, reason: 'unreachable', message: 'ECONNREFUSED' });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
  });

  it('points a legacy codex.transport: tui conversation at its own pane', async () => {
    const { adapter } = adapterWith({ ok: false, reason: 'token-missing', message: 'no token' }, { transport: 'tui' });
    const target = await adapter.resolveTarget(OWNER);
    expect(target).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(target.ok ? '' : target.message).toMatch(/Runtime log/);
  });

  it('refuses an endpoint other than the conversation\'s own socket', async () => {
    const elsewhere = ok(200, { ok: true, threadId: THREAD, endpoint: 'unix:///tmp/evil.sock', generation: GENERATION, navigationEpoch: 0 });
    const { adapter } = adapterWith(elsewhere);
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'restart-required' });
  });

  it('refuses when the recorded endpoint is missing or differs', async () => {
    const { adapter } = adapterWith(READY, { files: { [`${AGENT_DIR}/codex-native-endpoint`]: 'unix:///other.sock\n' } });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'restart-required' });
  });

  it('rejects a malformed thread id instead of attaching', async () => {
    const { adapter } = adapterWith(ok(200, { ok: true, threadId: '--help', endpoint: ENDPOINT, generation: GENERATION }));
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
  });

  it('reports a missing codex binary', async () => {
    const { adapter } = adapterWith(READY, { binary: null });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'binary-missing' });
  });

  it('omits CODEX_HOME when the conversation has no managed home', async () => {
    const { adapter } = adapterWith(READY, { codexHomeExists: false });
    const target = await adapter.resolveTarget(OWNER);
    expect(target.ok && 'env' in target).toBe(false);
  });
});
