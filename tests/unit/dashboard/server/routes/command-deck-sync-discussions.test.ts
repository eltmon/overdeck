/**
 * PAN-5153 W6: POST /api/command-deck/planning/:issueId/sync-discussions syncs
 * the issue's own repository. It used to send every gh call to the first
 * tracked repository, so an issue of the second repository read the wrong
 * issue and PRs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { execFileMock, projectRoot } = vi.hoisted(() => ({
  execFileMock: vi.fn<(file: string, args: string[], options?: unknown) => Promise<{ stdout: string; stderr: string }>>(),
  projectRoot: { path: '' },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = execFileMock;
  return { ...actual, execFile };
});

vi.mock('../../../../../src/lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssue: (issueId: string) => {
      const match = /^(ONE|TWO)-(\d+)$/.exec(issueId);
      if (!match) return { isGitHub: false };
      return { isGitHub: true, owner: 'acme', repo: match[1].toLowerCase(), prefix: match[1], number: Number(match[2]) };
    },
  };
});

vi.mock('../../../../../src/dashboard/server/services/tracker-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/dashboard/server/services/tracker-config.js')>();
  return {
    ...actual,
    getGitHubConfig: () => ({
      repos: [
        { owner: 'acme', repo: 'one', prefix: 'ONE' },
        { owner: 'acme', repo: 'two', prefix: 'TWO' },
      ],
    }),
  };
});

vi.mock('../../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: () => ({ projectKey: 'two', projectName: 'Two', projectPath: projectRoot.path }),
  };
});

import { commandDeckRouteLayer } from '../../../../../src/dashboard/server/routes/command-deck.js';
import { LinearClient } from '../../../../../src/dashboard/server/services/linear-client.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import { getOverdeckHome } from '../../../../../src/lib/paths.js';

async function postSync(issueId: string) {
  const request = HttpServerRequest.fromWeb(new Request(
    `http://localhost/api/command-deck/planning/${issueId}/sync-discussions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token' },
      body: JSON.stringify({ tracker: 'github' }),
    },
  ));
  const linear = Layer.succeed(LinearClient, {
    getIssue: vi.fn(),
    getComments: vi.fn(),
  } as unknown as LinearClient['Type']);
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(commandDeckRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ).pipe(Effect.provide(linear)),
    ),
  );
  return response.status;
}

describe('sync-discussions uses the issue\'s own repository (PAN-5153)', () => {
  beforeEach(() => {
    projectRoot.path = mkdtempSync(join(tmpdir(), 'pan-sync-discussions-'));
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
    rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
    _resetInternalTokenCacheForTests();
    execFileMock.mockReset();
    execFileMock.mockImplementation(async (_file, args) => {
      if (args[0] === 'pr' && args[1] === 'list') return { stdout: '11\n', stderr: '' };
      return { stdout: 'comment body\n', stderr: '' };
    });
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    rmSync(projectRoot.path, { recursive: true, force: true });
  });

  it('sends every gh call for TWO-5 to acme/two', async () => {
    expect(await postSync('TWO-5')).toBe(200);

    const calls = execFileMock.mock.calls.filter(([file]) => file === 'gh').map(([, args]) => args);
    const view = calls.find((args) => args[0] === 'issue' && args[1] === 'view');
    const list = calls.find((args) => args[0] === 'pr' && args[1] === 'list');
    const prView = calls.find((args) => args[0] === 'pr' && args[1] === 'view');
    expect(view?.[2]).toBe('5');
    for (const args of [view, list, prView]) {
      expect(args).toBeDefined();
      expect(args![args!.indexOf('--repo') + 1]).toBe('acme/two');
    }
  });
});
