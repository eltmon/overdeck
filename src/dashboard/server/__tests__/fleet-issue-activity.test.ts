/** PAN-4651 WI-22 (D-4651-16): which machine is working on an issue. */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import { buildFleetIssueActivity, type IssueActivityFleetDeps } from '../routes/fleet-awareness.js';
import { handleIssueActivity } from '../routes/machines-peer.js';
import { readJsonResponse } from '../routes/machines-work.js';
import { issueActivity } from '../services/issue-activity.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;

describe('issue activity (D-4651-16)', () => {
  it('lists this machine\'s agents and unarchived conversations for the issue', async () => {
    const answer = await issueActivity('pan-7', {
      agents: async () => [{ id: 'agent-pan-7', issueId: 'PAN-7', status: 'running' }, { id: 'agent-pan-8', issueId: 'PAN-8', status: 'running' }],
      conversations: async () => [
        { name: 'conv-a', issueId: 'PAN-7', isWorking: true, archivedAt: null },
        { name: 'conv-b', issueId: 'PAN-7', isWorking: false, archivedAt: '2026-11-01T00:00:00Z' },
        { name: 'conv-c', issueId: null },
      ],
    });
    expect(answer).toEqual({ agents: [{ id: 'agent-pan-7', status: 'running' }], conversations: [{ name: 'conv-a', isWorking: true }] });
  });

  it('ac22: an agent for PAN-7 on desk and a conversation here come back per machine', async () => {
    const deps: IssueActivityFleetDeps = {
      links: async () => [DESK],
      status: (() => ({ state: 'online' })) as never,
      self: async () => ({ environmentId: 'env-laptop', label: 'laptop' }),
      local: async () => ({ agents: [], conversations: [{ name: 'conv-a', isWorking: true }] }),
      search: vi.fn(async (_env: string, path: string) => {
        expect(path).toBe('/api/machines/issue-activity?issue=PAN-7');
        return { status: 200, json: { agents: [{ id: 'agent-pan-7', status: 'running' }], conversations: [] } };
      }),
    };
    expect(await buildFleetIssueActivity('PAN-7', deps)).toEqual({ machines: [
      { environmentId: 'env-laptop', label: 'laptop', self: true, agents: [], conversations: [{ name: 'conv-a', isWorking: true }] },
      { environmentId: 'env-desk', label: 'desk', self: false, agents: [{ id: 'agent-pan-7', status: 'running' }], conversations: [] },
    ] });
  });

  it('the owner route answers a machine credential only, for a well-formed issue id', async () => {
    const read = vi.fn(async () => ({ agents: [], conversations: [] }));
    const machine = { kind: 'machine' as const, tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor: 'operator' as const, access: 'operator' as const };
    expect(readJsonResponse(await handleIssueActivity(machine, 'PAN-7', read)).status).toBe(200);
    expect(readJsonResponse(await handleIssueActivity({ kind: 'root-session' }, 'PAN-7', read)).status).toBe(403);
    expect(readJsonResponse(await handleIssueActivity(machine, '../x', read)).status).toBe(400);
  });
});
