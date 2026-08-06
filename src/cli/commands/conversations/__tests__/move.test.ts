/**
 * Regression tests for `pan conversations move` (PAN-1577).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../../tests/helpers/overdeck-test-db.js';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

vi.mock('../../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../../lib/config.js')>()),
  getDashboardApiUrlSync: vi.fn(() => 'http://dashboard.test'),
}));

// PAN-1577: isolate project resolution from real projects.yaml I/O. Only
// 'effective-target' is a "registered" project here (existing tests move to
// 'krux'/'myn', which stay unregistered so their raw-key fallback labels are
// unaffected) — used solely by the effective-project-key resolution test.
vi.mock('../../../../lib/projects.js', () => ({
  getProjectSync: vi.fn((key: string) => (key === 'effective-target' ? { name: 'Effective Target', path: '/tmp/effective-target-project' } : null)),
  listProjectsSync: vi.fn(() => [
    { key: 'effective-target', config: { name: 'Effective Target', path: '/tmp/effective-target-project' } },
  ]),
}));

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  process.env.HOME = odb.home;
});

afterEach(() => {
  delete process.env.HOME;
  teardownOverdeckTestDb(odb);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function seedConversation(opts: { name: string; title?: string | null; projectKey?: string | null; cwd?: string }) {
  const { createConversation, setConversationProjectKey } = await import('../../../../lib/overdeck/conversations.js');
  const conv = createConversation({
    name: opts.name,
    tmuxSession: `tmux-${opts.name}`,
    cwd: opts.cwd ?? '/tmp/move-test-workspace',
    claudeSessionId: `sess-${opts.name}`,
    title: opts.title ?? null,
    harness: 'claude-code',
  });
  if (opts.projectKey !== undefined) setConversationProjectKey(opts.name, opts.projectKey);
  return conv;
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));
  vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg ?? '')));
  return { logs, errors };
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
}

describe('moveAction', () => {
  it('resolves by exact name and moves via the PATCH endpoint (ac1)', async () => {
    await seedConversation({ name: 'move-exact', title: 'Exact match conv' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projectKey: 'myn' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { moveAction } = await import('../move.js');
    const { logs, errors } = captureConsole();
    const exitSpy = mockExit();

    await moveAction('move-exact', 'myn');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://dashboard.test/api/conversations/move-exact/move',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ projectKey: 'myn' }),
      }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(logs.join('\n')).toContain('Exact match conv');
  });

  it('resolves by a unique fuzzy title match (ac1)', async () => {
    await seedConversation({ name: 'move-fuzzy-1', title: 'Refactor the billing pipeline' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projectKey: 'myn' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { moveAction } = await import('../move.js');
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await moveAction('billing pipeline', 'myn');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dashboard.test/api/conversations/move-fuzzy-1/move',
      expect.anything(),
    );
  });

  it('prints the resolved title and old→new project on success (ac2)', async () => {
    await seedConversation({ name: 'move-ac2', title: 'My Conversation', projectKey: 'krux' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projectKey: 'myn' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { moveAction } = await import('../move.js');
    const { logs } = captureConsole();
    mockExit();

    await moveAction('move-ac2', 'myn');

    const output = logs.join('\n');
    expect(output).toContain('My Conversation');
    expect(output).toContain('krux');
    expect(output).toContain('myn');
  });

  it('shows the cwd-derived project as "from" when there is no explicit override (effective resolution)', async () => {
    await seedConversation({
      name: 'move-effective-cwd',
      title: 'Conversation without an override',
      cwd: '/tmp/effective-target-project/sub',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projectKey: 'krux' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { moveAction } = await import('../move.js');
    const { logs, errors } = captureConsole();
    mockExit();

    await moveAction('move-effective-cwd', 'krux');

    expect(errors).toEqual([]);
    expect(logs.join('\n')).toContain('from Effective Target to krux');
  });

  it('exits non-zero with a clear message when no conversation matches (ac3)', async () => {
    const { moveAction } = await import('../move.js');
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(moveAction('does-not-exist-anywhere', 'myn')).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('No conversation found matching "does-not-exist-anywhere"');
  });

  it('exits non-zero with a clear message when the fuzzy match is ambiguous (ac3)', async () => {
    await seedConversation({ name: 'move-ambig-1', title: 'Fix the dashboard header' });
    await seedConversation({ name: 'move-ambig-2', title: 'Fix the dashboard footer' });
    const { moveAction } = await import('../move.js');
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(moveAction('dashboard', 'myn')).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = errors.join('\n');
    expect(output).toContain('Ambiguous match for "dashboard"');
    expect(output).toContain('move-ambig-1');
    expect(output).toContain('move-ambig-2');
  });

  it('exits non-zero with a clear message for an unknown project (ac3)', async () => {
    await seedConversation({ name: 'move-unknown-project', title: 'Some conversation' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unknown project: nope' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { moveAction } = await import('../move.js');
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(moveAction('move-unknown-project', 'nope')).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('Unknown project: nope');
  });

  it('exits non-zero with a clear message when the dashboard is unreachable (ac3)', async () => {
    await seedConversation({ name: 'move-dashboard-down', title: 'Some conversation' });
    // Matches Node 22's real global-fetch rejection shape: a TypeError whose
    // message is the generic "fetch failed", with the actual errno nested on
    // `.cause`, not a top-level `.code` (PAN-1577 review fix).
    const connRefused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    const fetchMock = vi.fn().mockRejectedValue(connRefused);
    vi.stubGlobal('fetch', fetchMock);
    const { moveAction } = await import('../move.js');
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(moveAction('move-dashboard-down', 'myn')).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('Dashboard not running');
  });
});

describe('registerConversationsCommands', () => {
  it('registers move <query> <projectKey>', async () => {
    const { registerConversationsCommands } = await import('../index.js');
    const program = new Command();
    registerConversationsCommands(program);

    const conversations = program.commands.find((command) => command.name() === 'conversations');
    const move = conversations?.commands.find((command) => command.name() === 'move');

    expect(move).toBeDefined();
    expect(move?.registeredArguments.map((arg) => arg.name())).toEqual(['query', 'projectKey']);
  });
});
