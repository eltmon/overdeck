import { realpath } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cause, Chunk, Effect, Exit, Fiber, Stream } from 'effect';
import { PanRpcError, WS_METHODS, type ExplorerWatchEvent } from '@overdeck/contracts';
import type { ExplorerRoot } from '../services/explorer/roots.js';
import type { WatchListener } from '../services/explorer/watch-supervisor.js';
import { makeFixtureRepo, type FixtureRepo } from '../services/explorer/__tests__/fixture-repo.js';

const mocks = vi.hoisted(() => ({
  resolveExplorerRoot: vi.fn(),
  listener: null as WatchListener | null,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../services/explorer/roots.js', () => ({ resolveExplorerRoot: mocks.resolveExplorerRoot }));
vi.mock('../services/explorer/watch-supervisor.js', () => ({
  getExplorerWatchSupervisor: () => ({ subscribe: mocks.subscribe, dispose: async () => {} }),
}));

const { explorerRpcHandlers } = await import('../ws-rpc-explorer.js');

let repo: FixtureRepo;

function root(kind: ExplorerRoot['kind'] = 'issue'): ExplorerRoot {
  return { kind, id: `${kind}:x`, absPath: repo.dir, writable: kind !== 'project', projectKey: 'p', defaultBranch: 'main' };
}

function failureOf(exit: Exit.Exit<unknown, unknown>): PanRpcError {
  expect(Exit.isFailure(exit)).toBe(true);
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  expect(error).toBeInstanceOf(PanRpcError);
  return error as PanRpcError;
}

beforeAll(async () => {
  repo = await makeFixtureRepo({ '.gitignore': 'node_modules/\n', 'a.txt': 'a\n', 'node_modules/pkg/index.js': '' });
  repo.dir = await realpath(repo.dir);
});

afterAll(async () => {
  await repo.cleanup();
});

beforeEach(() => {
  mocks.resolveExplorerRoot.mockReset();
  mocks.resolveExplorerRoot.mockResolvedValue(root());
  mocks.unsubscribe.mockReset();
  mocks.listener = null;
  mocks.subscribe.mockReset();
  mocks.subscribe.mockImplementation(async (_spec: unknown, listener: WatchListener) => {
    mocks.listener = listener;
    return mocks.unsubscribe;
  });
});

describe('explorerRpcHandlers read methods', () => {
  it('pan.explorerListDir lists the root with node_modules ignored', async () => {
    const result = await Effect.runPromise(explorerRpcHandlers[WS_METHODS.explorerListDir]({ rootId: 'issue:x', path: '' }));
    const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
    expect(byName['node_modules']).toMatchObject({ kind: 'dir', ignored: true });
    expect(byName['a.txt']).toMatchObject({ kind: 'file', ignored: false });
  });

  it('passes a PanRpcError code through and maps a plain Error to EXPLORER_FAILED', async () => {
    mocks.resolveExplorerRoot.mockRejectedValueOnce(new PanRpcError({ code: 'ROOT_NOT_FOUND', message: 'nope' }));
    const notFound = await Effect.runPromiseExit(explorerRpcHandlers[WS_METHODS.explorerGitStatus]({ rootId: 'issue:x' }));
    expect(failureOf(notFound).code).toBe('ROOT_NOT_FOUND');

    mocks.resolveExplorerRoot.mockRejectedValueOnce(new Error('boom'));
    const failed = await Effect.runPromiseExit(explorerRpcHandlers[WS_METHODS.explorerGitStatus]({ rootId: 'issue:x' }));
    expect(failureOf(failed)).toMatchObject({ code: 'EXPLORER_FAILED', message: 'boom' });
  });

  it('pan.explorerGitStage refuses a project root', async () => {
    mocks.resolveExplorerRoot.mockResolvedValueOnce(root('project'));
    const exit = await Effect.runPromiseExit(
      explorerRpcHandlers[WS_METHODS.explorerGitStage]({ rootId: 'project:p', paths: ['a.txt'], action: 'stage' }),
    );
    expect(failureOf(exit).code).toBe('EDIT_WORKSPACE_REQUIRED');
  });

  it('pan.explorerReadFile and the search methods reach their services', async () => {
    const read = await Effect.runPromise(explorerRpcHandlers[WS_METHODS.explorerReadFile]({ rootId: 'issue:x', path: 'a.txt' }));
    expect(read).toMatchObject({ kind: 'text', text: 'a\n' });
    const files = await Effect.runPromise(
      explorerRpcHandlers[WS_METHODS.explorerSearchFiles]({ rootId: 'issue:x', query: 'a.txt', limit: 10 }),
    );
    expect(files.paths).toContain('a.txt');
    const content = await Effect.runPromise(
      explorerRpcHandlers[WS_METHODS.explorerSearchContent]({
        rootId: 'issue:x',
        query: 'a',
        regex: false,
        caseSensitive: true,
        limit: 10,
      }),
    );
    expect(content.matches.map((m) => m.path)).toContain('a.txt');
  });
});

describe('pan.explorerWatch', () => {
  it('emits supervisor batches and unsubscribes when interrupted', async () => {
    const events: ExplorerWatchEvent[] = [{ kind: 'create', path: 'new.txt' }];
    const fiber = Effect.runFork(
      Stream.runCollect(Stream.take(explorerRpcHandlers[WS_METHODS.explorerWatch]({ rootId: 'issue:x' }), 1)),
    );
    await vi.waitFor(() => expect(mocks.listener).not.toBeNull());
    expect(mocks.subscribe).toHaveBeenCalledWith({ id: 'issue:x', absPath: repo.dir, kind: 'issue' }, expect.any(Function));
    mocks.listener!(events);
    const taken = await Effect.runPromise(Fiber.join(fiber));
    expect(Chunk.toReadonlyArray(Chunk.fromIterable(taken))).toEqual([{ events }]);
    await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledTimes(1));
  });

  it('unsubscribes when a running stream is interrupted', async () => {
    const fiber = Effect.runFork(Stream.runDrain(explorerRpcHandlers[WS_METHODS.explorerWatch]({ rootId: 'issue:x' })));
    await vi.waitFor(() => expect(mocks.listener).not.toBeNull());
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('fails the stream with the root error', async () => {
    mocks.resolveExplorerRoot.mockRejectedValueOnce(new PanRpcError({ code: 'ROOT_NOT_FOUND', message: 'nope' }));
    const exit = await Effect.runPromiseExit(Stream.runDrain(explorerRpcHandlers[WS_METHODS.explorerWatch]({ rootId: 'x' })));
    expect(failureOf(exit).code).toBe('ROOT_NOT_FOUND');
  });
});

describe('explorerRpcHandlers write stubs', () => {
  it('pan.explorerWriteFile fails NOT_IMPLEMENTED naming PAN-5187', async () => {
    const exit = await Effect.runPromiseExit(
      explorerRpcHandlers[WS_METHODS.explorerWriteFile]({
        rootId: 'issue:PAN-5185',
        path: 'a.ts',
        text: 'x',
        expectedSignature: null,
        allowMissing: false,
      }),
    );
    const error = failureOf(exit);
    expect(error.code).toBe('NOT_IMPLEMENTED');
    expect(error.message).toContain('PAN-5187');
  });

  it.each([
    [WS_METHODS.explorerCreate, { rootId: 'r', path: 'a', kind: 'file' as const }],
    [WS_METHODS.explorerRename, { rootId: 'r', from: 'a', to: 'b' }],
    [WS_METHODS.explorerCopy, { rootId: 'r', from: 'a', to: 'b' }],
    [WS_METHODS.explorerDelete, { rootId: 'r', paths: ['a'] }],
    [WS_METHODS.explorerRestore, { rootId: 'r', trashId: 't' }],
  ] as const)('%s fails NOT_IMPLEMENTED naming PAN-5187', async (method, payload) => {
    const handler = explorerRpcHandlers[method] as (input: typeof payload) => Effect.Effect<unknown, PanRpcError>;
    const error = failureOf(await Effect.runPromiseExit(handler(payload)));
    expect(error.code).toBe('NOT_IMPLEMENTED');
    expect(error.message).toContain('PAN-5187');
  });

  it('pan.explorerBeginEdit fails NOT_IMPLEMENTED naming PAN-5191', async () => {
    const exit = await Effect.runPromiseExit(
      explorerRpcHandlers[WS_METHODS.explorerBeginEdit]({ projectKey: 'overdeck', forceNew: false }),
    );
    const error = failureOf(exit);
    expect(error.code).toBe('NOT_IMPLEMENTED');
    expect(error.message).toContain('PAN-5191');
  });
});
