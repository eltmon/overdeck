/**
 * PAN-4651 WI-4 (D-4651-3): the conversation work door creates the
 * conversation in the project whose slug matches the caller's, stamps the
 * caller's environment id, and refuses mismatches and non-machine callers.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import { conversationStartedBy, markConversationStartedBy } from '../../../lib/overdeck/conversation-provenance.js';
import { createConversation } from '../../../lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { type ConversationDoorDeps, handleWorkConversation, readJsonResponse } from '../routes/machines-work.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;

const laptop = (actor: 'operator' | { agentId: string } = { agentId: 'agent-pan-7' }): DashboardCredential => ({
  kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor, access: 'operator',
});

function deps(overrides: Partial<ConversationDoorDeps> = {}) {
  const create = vi.fn(async (body: Record<string, unknown>) => {
    const name = `conv-${Math.random().toString(36).slice(2, 8)}`;
    createConversation({ name, tmuxSession: name, cwd: home, harness: 'claude-code' });
    return { status: 201, body: { name, projectKey: body['projectKey'] ?? null } };
  });
  const value: ConversationDoorDeps = {
    listProjects: async () => [
      { key: 'overdeck', config: { name: 'Overdeck', path: '/srv/overdeck', github_repo: 'eltmon/overdeck' } as ProjectConfig },
      { key: 'web', config: { name: 'Web', path: '/srv/web', gitlab_repo: 'acme/web' } as ProjectConfig },
    ],
    thisLabel: async () => 'desk',
    create,
    markStartedBy: markConversationStartedBy,
    ...overrides,
  };
  return { value, create };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4651-work-conv-'));
  process.env.OVERDECK_HOME = home;
  closeOverdeckDatabase();
});

afterEach(() => {
  closeOverdeckDatabase();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('conversation work door (D-4651-3)', () => {
  it('ac4: creates in the matching project and stamps the caller environment id', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkConversation(laptop(), {
      gitOrigin: 'github.com/Eltmon/Overdeck', message: 'hi', model: 'claude-opus-5-5', cwd: '/etc',
    }, d.value));
    expect(response.status).toBe(201);
    const name = (response.body as { name: string }).name;
    expect(d.create).toHaveBeenCalledWith({ message: 'hi', model: 'claude-opus-5-5', projectKey: 'overdeck' });
    expect(conversationStartedBy(name)).toBe('env-laptop');
  });

  it('a null gitOrigin starts a conversation with no project', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkConversation(laptop('operator'), { gitOrigin: null, message: '' }, d.value));
    expect(response.status).toBe(201);
    expect(d.create).toHaveBeenCalledWith({ message: '' });
  });

  it('ac4: a slug this machine does not hold answers 404 project-missing naming this machine', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkConversation(laptop(), { gitOrigin: 'github.com/x/y', message: 'hi' }, d.value));
    expect(response).toEqual({ status: 404, body: { code: 'project-missing', gitOrigin: 'github.com/x/y', machine: 'desk', error: 'desk has no project for github.com/x/y' } });
    expect(d.create).not.toHaveBeenCalled();
  });

  it('a device, token or root credential answers 403 machine-only', async () => {
    const d = deps();
    for (const credential of [
      { kind: 'device', deviceId: 'd', scopes: ['admin'] },
      { kind: 'token', tokenId: 'k', scopes: ['operate'] },
      { kind: 'root-session' },
      null,
    ] as Array<DashboardCredential | null>) {
      const response = readJsonResponse(await handleWorkConversation(credential, { gitOrigin: null, message: 'hi' }, d.value));
      expect(response.status).toBe(403);
      expect((response.body as { code: string }).code).toBe('machine-only');
    }
    expect(d.create).not.toHaveBeenCalled();
  });

  it('rejects a body without gitOrigin or message, and passes a create failure through unstamped', async () => {
    const markStartedBy = vi.fn();
    const d = deps({ markStartedBy, create: async () => ({ status: 400, body: { error: 'Invalid model' } }) });
    expect(readJsonResponse(await handleWorkConversation(laptop(), { message: 'hi' }, d.value)).status).toBe(400);
    expect(readJsonResponse(await handleWorkConversation(laptop(), { gitOrigin: null }, d.value)).status).toBe(400);
    expect(readJsonResponse(await handleWorkConversation(laptop(), { gitOrigin: null, message: 'x', model: 'bad model' }, d.value)))
      .toEqual({ status: 400, body: { error: 'Invalid model' } });
    expect(markStartedBy).not.toHaveBeenCalled();
  });
});
