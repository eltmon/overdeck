import { describe, expect, it, vi } from 'vitest';
import { createOpenCodeCompanionAdapter, OPENCODE_RESTART_REQUIRED_MESSAGE } from '../opencode-adapter.js';
import type { CompanionOwner } from '../lifecycle.js';

const OWNER: CompanionOwner = {
  conversationName: '20260923-0001',
  ownerSession: 'conv-20260923-0001',
  cwd: '/work/repo',
  harness: 'opencode',
};
const AGENT_DIR = '/home/op/.overdeck/agents/conv-20260923-0001';

function adapterWith(files: Record<string, string>, options: {
  status?: number;
  type?: string;
  fetchError?: Error;
  binary?: string | null;
} = {}) {
  const fetch = vi.fn(async () => {
    if (options.fetchError) throw options.fetchError;
    return { status: options.status ?? 200, ...(options.type ? { type: options.type } : {}) };
  });
  const readText = vi.fn(async (path: string) => files[path]);
  const resolveBinary = vi.fn(async () => (options.binary === undefined ? '/home/op/.opencode/bin/opencode' : options.binary));
  const adapter = createOpenCodeCompanionAdapter({
    overdeckHome: () => '/home/op/.overdeck',
    readText,
    resolveBinary,
    fetch,
  });
  return { adapter, fetch, readText, resolveBinary };
}

const RECORDED = {
  [`${AGENT_DIR}/opencode-port`]: '41234\n',
  [`${AGENT_DIR}/acp-session-id`]: 'ses_f324d4305ffe8Kx7kiYS2XjnYy\n',
};

describe('OpenCode companion adapter', () => {
  it('attaches the recorded server and exact session in the conversation cwd', async () => {
    const { adapter, fetch } = adapterWith(RECORDED);

    const target = await adapter.resolveTarget(OWNER);

    expect(target).toEqual({
      ok: true,
      argv: [
        '/home/op/.opencode/bin/opencode',
        'attach',
        'http://127.0.0.1:41234',
        '--session',
        'ses_f324d4305ffe8Kx7kiYS2XjnYy',
        '--dir',
        '/work/repo',
      ],
      cwd: '/work/repo',
      fingerprint: '41234:ses_f324d4305ffe8Kx7kiYS2XjnYy',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:41234/session/ses_f324d4305ffe8Kx7kiYS2XjnYy',
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: 'manual' }),
    );
  });

  it('never forks, continues, or starts a server', async () => {
    const { adapter } = adapterWith(RECORDED);
    const target = await adapter.resolveTarget(OWNER);
    if (!target.ok) throw new Error('expected target');
    expect(target.argv).not.toContain('--fork');
    expect(target.argv).not.toContain('--continue');
    expect(target.argv).not.toContain('serve');
    expect(target.argv).not.toContain('acp');
  });

  it('requires a restart for a pre-PAN-3937 conversation with no recorded port', async () => {
    const { adapter, fetch } = adapterWith({ [`${AGENT_DIR}/acp-session-id`]: 'ses_abc\n' });

    expect(await adapter.resolveTarget(OWNER)).toEqual({
      ok: false,
      reason: 'restart-required',
      message: OPENCODE_RESTART_REQUIRED_MESSAGE,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a starting owner while the session id is not recorded yet', async () => {
    const { adapter } = adapterWith({ [`${AGENT_DIR}/opencode-port`]: '41234\n' });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
    const { adapter: bare } = adapterWith({});
    expect(await bare.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
  });

  it.each([
    ['0', 'ses_abc'],
    ['70000', 'ses_abc'],
    ['41234; rm -rf /', 'ses_abc'],
    ['41234', 'ses_abc --fork'],
    ['41234', '../../etc/passwd'],
    ['41234', 'ses_'],
  ])('rejects malformed recorded values (port %j, session %j)', async (port, session) => {
    const { adapter, fetch } = adapterWith({
      [`${AGENT_DIR}/opencode-port`]: port,
      [`${AGENT_DIR}/acp-session-id`]: session,
    });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'restart-required' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an unreachable server as starting, not as a restart', async () => {
    const { adapter, resolveBinary } = adapterWith(RECORDED, { fetchError: new Error('ECONNREFUSED') });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
    expect(resolveBinary).not.toHaveBeenCalled();
  });

  it.each([
    ['a 3xx status', { status: 302 }],
    ['a 307 status', { status: 307 }],
    ['an opaque redirect', { status: 0, type: 'opaqueredirect' }],
  ])('never treats %s from the recorded port as healthy', async (_label, response) => {
    const { adapter, resolveBinary } = adapterWith(RECORDED, response);
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
    expect(resolveBinary).not.toHaveBeenCalled();
  });

  it('reports a session the server does not know', async () => {
    const { adapter } = adapterWith(RECORDED, { status: 404 });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'session-missing' });
  });

  it('treats other server errors as not ready', async () => {
    const { adapter } = adapterWith(RECORDED, { status: 503 });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'owner-starting' });
  });

  it('reports a missing opencode binary', async () => {
    const { adapter } = adapterWith(RECORDED, { binary: null });
    expect(await adapter.resolveTarget(OWNER)).toMatchObject({ ok: false, reason: 'binary-missing' });
  });

  it('reads only the owner agent directory', async () => {
    const { adapter, readText } = adapterWith(RECORDED);
    await adapter.resolveTarget(OWNER);
    expect(readText.mock.calls.map(([path]) => path).sort()).toEqual([
      `${AGENT_DIR}/acp-session-id`,
      `${AGENT_DIR}/opencode-port`,
    ]);
  });
});
