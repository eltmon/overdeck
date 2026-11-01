/**
 * PAN-4651 WI-6 (D-4651-3): the issue-start work door runs the extracted
 * POST /api/agents spawn helper after the project and origin check
 * (`lint:file-size` keeps routes/agents/spawn.ts from growing).
 */
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import { jsonResponse } from '../http-helpers.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { handleWorkIssueStart, type IssueStartDoorDeps, readJsonResponse } from '../routes/machines-work.js';

const laptop: DashboardCredential = {
  kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor: { agentId: 'agent-pan-7' }, access: 'operator',
};

function deps(status = 200) {
  const spawn = vi.fn((_input: { body: Record<string, unknown>; internalRequest: false }) =>
    Effect.succeed(jsonResponse(status === 200 ? { success: true } : { error: 'Issue PAN-7 is already closed' }, { status })));
  const value: IssueStartDoorDeps<never> = {
    listProjects: async () => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/srv/overdeck', github_repo: 'eltmon/overdeck' } as ProjectConfig }],
    thisLabel: async () => 'desk',
    projectKeyForIssue: async (issueId) => (issueId.toUpperCase().startsWith('PAN-') ? 'overdeck' : null),
    spawn,
  };
  return { value, spawn };
}

const run = (credential: DashboardCredential | null, issueId: string, body: unknown, d: IssueStartDoorDeps<never>) =>
  Effect.runPromise(handleWorkIssueStart(credential, issueId, body, d)).then(readJsonResponse);

describe('issue-start work door (D-4651-3)', () => {
  it('ac6: calls the extracted spawn helper with the issue id and options, not as an internal request', async () => {
    const d = deps();
    const answer = await run(laptop, 'PAN-7', { gitOrigin: 'github.com/eltmon/overdeck', model: 'claude-opus-5-5', effort: 'high' }, d.value);
    expect(answer).toEqual({ status: 200, body: { issueId: 'PAN-7', agentId: 'agent-pan-7' } });
    expect(d.spawn).toHaveBeenCalledWith({ body: { issueId: 'PAN-7', model: 'claude-opus-5-5', effort: 'high' }, internalRequest: false });
  });

  it('a prefix with no project, or another repository, answers 404 project-missing', async () => {
    const d = deps();
    expect(await run(laptop, 'ZZZ-1', { gitOrigin: 'github.com/eltmon/overdeck' }, d.value)).toMatchObject({ status: 404, body: { code: 'project-missing', machine: 'desk' } });
    expect(await run(laptop, 'PAN-7', { gitOrigin: 'github.com/x/y' }, d.value)).toMatchObject({ status: 404, body: { code: 'project-missing' } });
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('passes a refusal from the start gates through unchanged', async () => {
    expect(await run(laptop, 'PAN-7', { gitOrigin: 'github.com/eltmon/overdeck' }, deps(422).value))
      .toEqual({ status: 422, body: { error: 'Issue PAN-7 is already closed' } });
  });

  it('refuses a non-machine credential', async () => {
    const d = deps();
    expect(await run({ kind: 'root-session' }, 'PAN-7', { gitOrigin: null }, d.value)).toMatchObject({ status: 403, body: { code: 'machine-only' } });
    expect(d.spawn).not.toHaveBeenCalled();
  });
});
