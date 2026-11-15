/**
 * PAN-5288 WI-6: the conversation and project changes routes, and their
 * route scopes. The file gets its own Overdeck home, set before any module
 * loads, so the registered project and conversation stay local to it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, type Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const isolated = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const saved = process.env.OVERDECK_HOME;
  const overdeckHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-5288-routes-home-'));
  process.env.OVERDECK_HOME = overdeckHome;
  return { saved, overdeckHome };
});

import { requiredScopeFor } from '../../../../../src/dashboard/server/route-scopes.js';
import { conversationDiffRoutes } from '../../../../../src/dashboard/server/routes/conversation-diffs.js';
import { projectChangesRouteLayer } from '../../../../../src/dashboard/server/routes/project-changes.js';
import { createConversation } from '../../../../../src/lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../../../src/lib/overdeck/infra.js';
import { registerProject } from '../../../../../src/lib/projects.js';

const gitEnv: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':'),
    OVERDECK_PAN_GIT_OP: '1',
    GIT_AUTHOR_NAME: 'routes', GIT_AUTHOR_EMAIL: 'routes@example.test',
    GIT_COMMITTER_NAME: 'routes', GIT_COMMITTER_EMAIL: 'routes@example.test',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgSign', GIT_CONFIG_VALUE_0: 'false',
  };
  delete env.OVERDECK_AGENT_ID;
  delete env.OVERDECK_CONVERSATION;
  return env;
})();

let root: string;
let repo: string;

async function get(layer: Layer.Layer<never, never, never>, url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://overdeck.localhost${url}`));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(layer), (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const raw = response.body as { body?: Uint8Array } | null;
  return { status: response.status, body: JSON.parse(new TextDecoder().decode(raw?.body)) as Record<string, unknown> };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-5288-routes-'));
  repo = join(root, 'repo');
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo], { env: gitEnv });
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: repo, env: gitEnv });
  execFileSync('git', ['commit', '--quiet', '-m', 'first', '--trailer', 'Overdeck-Agent: agent-wfx-1'], { cwd: repo, env: gitEnv });
  registerProject('routes-fixture', { name: 'Routes fixture', path: repo, issue_prefix: 'RTF' });
  createConversation({ name: 'routes-conv', tmuxSession: 'conv-routes-conv', cwd: repo });
});

afterAll(() => {
  closeOverdeckDatabase();
  if (isolated.saved === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = isolated.saved;
  rmSync(root, { recursive: true, force: true });
  rmSync(isolated.overdeckHome, { recursive: true, force: true });
});

describe('GET /api/conversations/:name/changes', () => {
  it('returns 200 with the requested scope', async () => {
    const response = await get(conversationDiffRoutes, '/api/conversations/routes-conv/changes?scope=uncommitted');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ conversation: 'routes-conv', scope: 'uncommitted', commits: [] });
  });

  it('returns 400 for an unknown scope and 404 for an unknown conversation', async () => {
    expect(await get(conversationDiffRoutes, '/api/conversations/routes-conv/changes?scope=bogus'))
      .toEqual({ status: 400, body: { error: 'Invalid scope' } });
    expect((await get(conversationDiffRoutes, '/api/conversations/nobody/changes')).status).toBe(404);
  });
});

describe('GET /api/projects/:projectKey/changes', () => {
  it('returns 200 with the project key and its attributed commits', async () => {
    const response = await get(projectChangesRouteLayer, '/api/projects/routes-fixture/changes?since=7d');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ projectKey: 'routes-fixture', branch: 'main' });
    expect(response.body['commits']).toMatchObject([{ subject: 'first', by: { kind: 'agent', id: 'agent-wfx-1', title: 'WFX-1' } }]);
  });

  it('returns 400 for an invalid since and 404 for an unknown key', async () => {
    expect(await get(projectChangesRouteLayer, '/api/projects/routes-fixture/changes?since=abc'))
      .toEqual({ status: 400, body: { error: 'Invalid since' } });
    expect((await get(projectChangesRouteLayer, '/api/projects/nope/changes')).status).toBe(404);
  });
});

describe('route scopes', () => {
  it('reads conversation changes with read:conversations and keeps project changes admin', () => {
    expect(requiredScopeFor('GET', '/api/conversations/x/changes')).toBe('read:conversations');
    expect(requiredScopeFor('GET', '/api/projects/x/changes')).toBe('admin');
  });
});
