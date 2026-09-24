/**
 * `pan conv link-pr` / `unlink-pr` / `prs` (PAN-3822).
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
  getDashboardApiUrl: vi.fn(() => 'http://dashboard.test'),
}));

const linkMock = vi.fn();
const unlinkMock = vi.fn();
const getMock = vi.fn();
vi.mock('../../../../lib/overdeck/conversation-pull-request-commands.js', () => ({
  linkPullRequestToConversation: (...args: unknown[]) => linkMock(...args),
  unlinkPullRequestFromConversation: (...args: unknown[]) => unlinkMock(...args),
  getConversationPullRequests: (...args: unknown[]) => getMock(...args),
}));

const LINK = {
  host: 'github.com', repository: 'eltmon/overdeck', number: 42, url: 'https://github.com/eltmon/overdeck/pull/42',
  source: 'agent', linkedAt: '2026-09-24T00:00:00.000Z', dismissedAt: null, snapshot: null,
};

let odb: OverdeckTestDb;

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  process.env.HOME = odb.home;
  delete process.env.OVERDECK_AGENT_ID;
  linkMock.mockReset();
  unlinkMock.mockReset();
  getMock.mockReset();
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name: 'pr-conv', tmuxSession: 'tmux-pr-conv', cwd: '/tmp/pr-conv', title: 'PR conversation', harness: 'claude-code' });
});

afterEach(() => {
  delete process.env.HOME;
  delete process.env.OVERDECK_AGENT_ID;
  teardownOverdeckTestDb(odb);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const connRefused = () => new TypeError('fetch failed', {
  cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
});

describe('linkPrAction', () => {
  it('POSTs to the dashboard with the agent source inside an agent', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-1';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(LINK, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { linkPrAction } = await import('../pull-requests.js');
    const { logs } = captureConsole();

    await linkPrAction('pr-conv', '#42');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://dashboard.test/api/conversations/pr-conv/pull-requests');
    expect(JSON.parse(String(init.body))).toEqual({ ref: '#42', source: 'agent' });
    expect(logs.join('\n')).toContain('Linked eltmon/overdeck#42 to pr-conv (agent)');
  });

  it('defaults to manual outside an agent and honours --source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(LINK, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { linkPrAction } = await import('../pull-requests.js');
    captureConsole();

    await linkPrAction('pr-conv', '#42');
    await linkPrAction('PR conversation', '#42', { source: 'agent' });

    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).source).toBe('manual');
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)).source).toBe('agent');
  });

  it('writes through the command module when the dashboard is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connRefused()));
    linkMock.mockResolvedValue({ ok: true, status: 201, body: LINK });
    const { linkPrAction } = await import('../pull-requests.js');
    const { logs } = captureConsole();

    await linkPrAction('pr-conv', 'https://github.com/eltmon/overdeck/pull/42');

    expect(linkMock).toHaveBeenCalledWith('pr-conv', 'https://github.com/eltmon/overdeck/pull/42', 'manual');
    expect(logs.join('\n')).toContain('Linked eltmon/overdeck#42');
  });

  it('exits 1 with the API message for a foreign repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'someone/else is not a repository of this conversation', code: 'foreign_repository' }, 400)));
    const { linkPrAction } = await import('../pull-requests.js');
    const { errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(linkPrAction('pr-conv', 'someone/else#1')).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('not a repository');
  });

  it('exits 2 when no conversation matches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { linkPrAction } = await import('../pull-requests.js');
    captureConsole();
    mockExit();

    await expect(linkPrAction('no-such-conversation', '#42')).rejects.toThrow('exit 2');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('unlinkPrAction', () => {
  it('DELETEs with the ref in the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ unlinked: true, link: LINK }));
    vi.stubGlobal('fetch', fetchMock);
    const { unlinkPrAction } = await import('../pull-requests.js');
    const { logs } = captureConsole();

    await unlinkPrAction('pr-conv', '#42');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://dashboard.test/api/conversations/pr-conv/pull-requests?ref=%2342');
    expect(init.method).toBe('DELETE');
    expect(logs.join('\n')).toContain('Unlinked eltmon/overdeck#42 from pr-conv');
  });

  it('exits 1 (not 2) when the PR is not linked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'eltmon/overdeck#42 is not linked to this conversation', code: 'not_linked' }, 404)));
    const { unlinkPrAction } = await import('../pull-requests.js');
    captureConsole();
    const exitSpy = mockExit();

    await expect(unlinkPrAction('pr-conv', '#42')).rejects.toThrow('exit 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('prsAction', () => {
  it('prints links and marks the effective one', async () => {
    getMock.mockReturnValue({ ok: true, status: 200, body: { links: [LINK], effective: LINK } });
    const { prsAction } = await import('../pull-requests.js');
    const { logs } = captureConsole();

    await prsAction('pr-conv');

    expect(logs.join('\n')).toContain('* eltmon/overdeck#42  [agent, not synced]');
  });

  it('prints JSON with --json', async () => {
    getMock.mockReturnValue({ ok: true, status: 200, body: { links: [], effective: null } });
    const { prsAction } = await import('../pull-requests.js');
    const { logs } = captureConsole();

    await prsAction('pr-conv', { json: true });

    expect(JSON.parse(logs.join('\n'))).toEqual({ links: [], effective: null });
  });
});

describe('registerConversationsCommands', () => {
  it('registers link-pr, unlink-pr, and prs', async () => {
    const { registerConversationsCommands } = await import('../index.js');
    const program = new Command();
    registerConversationsCommands(program);
    const conversations = program.commands.find((command) => command.name() === 'conversations');
    const args = (name: string) => conversations?.commands.find((command) => command.name() === name)
      ?.registeredArguments.map((arg) => arg.name());

    expect(args('link-pr')).toEqual(['query', 'ref']);
    expect(args('unlink-pr')).toEqual(['query', 'ref']);
    expect(args('prs')).toEqual(['query']);
  });
});
