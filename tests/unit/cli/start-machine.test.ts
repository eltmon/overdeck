/** PAN-4651 WI-14 (FR-1, D-4651-7/12): `pan start <issue> --machine`. */
import { describe, expect, it, vi } from 'vitest';

import { startOnMachine, type StartMachineDeps } from '../../../src/cli/commands/start-machine.js';
import type { IssueOptions } from '../../../src/cli/commands/start-options.js';
import { FLY_CLI_REFUSAL } from '../../../src/cli/commands/worker-remote.js';

function makeDeps(answers: { placement?: unknown; unpushed?: boolean; workspace?: string | null } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<{ path: string; body?: unknown; headers?: Record<string, string> }> = [];
  const deps: StartMachineDeps = {
    call: vi.fn(async (path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => {
      calls.push({ path, body: init.body, headers: init.headers });
      if (path === '/api/fleet/placement') return { status: 200, json: answers.placement };
      if (path === '/api/machines') return { status: 200, json: { self: { environmentId: 'env-laptop', label: 'laptop' }, links: [{ environmentId: 'env-desk', label: 'desk' }] } };
      if (path.startsWith('/api/fleet/issues/')) return { status: 200, json: { issueId: 'PAN-7', agentId: 'agent-pan-7' } };
      return { status: 404, json: null };
    }),
    senderId: () => 'conv-operator-1',
    issueOrigin: async () => 'github.com/eltmon/overdeck',
    pushCheck: vi.fn(async () => (answers.unpushed ? { ok: false as const, message: '1 commit on feature/pan-7 is not pushed; desk starts from origin. Re-run with --push-first to push them, or --ignore-unpushed.' } : { ok: true as const, note: null })),
    workspaceOf: async () => (answers.workspace === undefined ? '/p/workspaces/feature-pan-7' : answers.workspace),
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
    exit: vi.fn(async () => undefined),
  };
  return { deps, out, err, calls };
}

const options = (extra: Partial<IssueOptions>): IssueOptions => ({ model: '', ...extra }) as IssueOptions;

describe('pan start --machine (PAN-4651 WI-14)', () => {
  it('ac14: a remote target posts the fleet route and prints Started <issue> on <label>', async () => {
    const { deps, out, calls } = makeDeps();
    expect(await startOnMachine('pan-7', options({ machine: 'desk', effort: 'high' }), deps)).toBe(true);
    const post = calls.find((call) => call.path === '/api/fleet/issues/PAN-7/start')!;
    expect(post.body).toEqual({ machine: 'desk', effort: 'high' });
    expect(post.headers).toEqual({ 'x-overdeck-sender': 'conv-operator-1' });
    expect(out).toEqual(['Started PAN-7 on desk']);
    expect(deps.pushCheck).toHaveBeenCalledWith('/p/workspaces/feature-pan-7', expect.objectContaining({ label: 'desk' }));
  });

  it('auto places with the issue project slug and prints the reason', async () => {
    const { deps, out, calls } = makeDeps({ placement: { ok: true, environmentId: 'env-desk', label: 'desk', self: false, reason: 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)', rejections: [] } });
    expect(await startOnMachine('PAN-7', options({ machine: 'auto', needs: 'docker' }), deps)).toBe(true);
    expect(calls[0]).toMatchObject({ path: '/api/fleet/placement', body: { gitOrigin: 'github.com/eltmon/overdeck', needs: ['docker'] } });
    expect(calls.find((call) => call.path === '/api/fleet/issues/PAN-7/start')!.body).toEqual({ machine: 'env-desk', needs: ['docker'] });
    expect(out).toEqual(['Started PAN-7 on desk', 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)']);
  });

  it('ac14: a self target falls through to the local path', async () => {
    const { deps, calls } = makeDeps();
    expect(await startOnMachine('PAN-7', options({ machine: 'laptop' }), deps)).toBe(false);
    expect(calls.some((call) => call.path.startsWith('/api/fleet/issues/'))).toBe(false);
    const auto = makeDeps({ placement: { ok: true, environmentId: 'env-laptop', label: 'laptop', self: true, reason: 'Auto → laptop (CPU pressure 1%, 8 GB free, 0 agents)', rejections: [] } });
    expect(await startOnMachine('PAN-7', options({ machine: 'auto' }), auto.deps)).toBe(false);
    expect(auto.err).toEqual(['Auto → laptop (CPU pressure 1%, 8 GB free, 0 agents)']);
  });

  it('ac1 (PAN-4743): --machine fly prints FLY_CLI_REFUSAL, exits 1 and never calls the dashboard', async () => {
    const { deps, err, calls } = makeDeps();
    expect(await startOnMachine('PAN-7', options({ machine: 'fly' }), deps)).toBe(true);
    expect(err).toEqual([FLY_CLI_REFUSAL]);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(calls).toEqual([]);
  });

  it('refuses unpushed workspace commits and an Auto with nothing that fits', async () => {
    const unpushed = makeDeps({ unpushed: true });
    expect(await startOnMachine('PAN-7', options({ machine: 'desk' }), unpushed.deps)).toBe(true);
    expect(unpushed.err[0]).toContain('is not pushed; desk starts from origin');
    expect(unpushed.calls.some((call) => call.path.startsWith('/api/fleet/issues/'))).toBe(false);
    const none = makeDeps({ placement: { ok: false, rejections: [{ environmentId: 'env-laptop', label: 'laptop', reason: 'no docker' }, { environmentId: 'env-desk', label: 'desk', reason: 'offline' }] } });
    expect(await startOnMachine('PAN-7', options({ machine: 'auto', needs: 'docker' }), none.deps)).toBe(true);
    expect(none.err).toEqual(['No machine fits: laptop: no docker; desk: offline']);
  });
});
