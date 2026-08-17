import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../../tests/helpers/overdeck-test-db.js';

vi.mock('chalk', () => {
  const identity = (value: unknown) => String(value);
  return { default: new Proxy(identity, { get: () => identity }) };
});

vi.mock('../../../../lib/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/config.js')>()),
  getDashboardApiUrlSync: vi.fn(() => 'http://dashboard.test'),
}));

let odb: OverdeckTestDb;

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name: 'repair-me', tmuxSession: 'conv-repair-me', cwd: '/tmp', title: 'Repair me' });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
  vi.spyOn(console, 'error').mockImplementation((value) => errors.push(String(value)));
  return { logs, errors };
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
}

describe('healAction', () => {
  it('posts the repair request and prints confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { logs } = captureConsole();
    const { healAction } = await import('../heal.js');

    await healAction('repair-me');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://dashboard.test/api/conversations/repair-me/clear-fork-state',
      { method: 'POST' },
    );
    expect(logs.join('\n')).toContain('Cleared fork/spawn failure state for repair-me (session alive)');
  });

  it('exits non-zero with dead-session guidance on 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Cannot clear failure state while the tmux session is not alive' }),
      { status: 409 },
    )));
    const { errors } = captureConsole();
    mockExit();
    const { healAction } = await import('../heal.js');

    await expect(healAction('repair-me')).rejects.toThrow('exit 1');

    expect(errors.join('\n')).toContain('stored failure state is truthful');
    expect(errors.join('\n')).toContain('pan conversations show <name>');
  });

  it('exits non-zero and lists candidates for an unknown name', async () => {
    const { errors } = captureConsole();
    mockExit();
    const { healAction } = await import('../heal.js');

    await expect(healAction('missing')).rejects.toThrow('exit 1');

    expect(errors.join('\n')).toContain('No conversation found matching "missing"');
  });
});
