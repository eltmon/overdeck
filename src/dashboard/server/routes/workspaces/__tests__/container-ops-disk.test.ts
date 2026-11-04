/**
 * PAN-4961 WI-5: POST /api/workspaces/:issueId/containerize creates a whole
 * workspace and its stack, so it reserves disk before it spawns anything and
 * releases the reservation exactly once on every terminal path.
 */
import { EventEmitter } from 'node:events';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(),
  reserveDiskFloor: vi.fn(),
  release: vi.fn(),
  estimateWorkspaceDiskCost: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  function exec() {
    throw new Error('exec is only called through promisify');
  }
  (exec as any)[kCustom] = (...args: unknown[]) => mocks.exec(...args);
  return { exec, spawn: mocks.spawn, execFile: vi.fn() };
});

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: mocks.existsSync,
}));

vi.mock('../../workspaces.js', () => ({
  appendActivityOutput: vi.fn(),
  getProjectPath: vi.fn(() => '/project'),
  logActivity: vi.fn(),
  requireTrustedMutationOrigin: vi.fn(() => null),
  updateActivity: vi.fn(),
}));

vi.mock('../../../../../lib/projects.js', () => ({
  extractTeamPrefix: vi.fn(),
  findProjectByTeam: vi.fn(),
  getProjectSync: vi.fn(() => null),
  listProjectsSync: vi.fn(() => []),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../../lib/memory/cli.js', () => ({ generateDailySummary: vi.fn() }));
vi.mock('../../../../../lib/db-provisioners/index.js', () => ({
  DatabaseProvisionerError: class extends Error {},
  getDatabaseProvisioner: vi.fn(),
}));

vi.mock('../../../../../lib/disk-floor.js', () => ({
  reserveDiskFloor: mocks.reserveDiskFloor,
}));

vi.mock('../../../../../lib/workspace/disk-cost.js', () => ({
  SEED_STACK_DISK_COST_BYTES: 2_000,
  estimateWorkspaceDiskCost: mocks.estimateWorkspaceDiskCost,
  invalidateWorkspaceDiskCostMemo: vi.fn(),
}));

import { containerOpsRouteLayer } from '../container-ops.js';

const HELD = 'Disk low — new workspace starts are held: 11.0 GiB free on the filesystem holding /project, 0.0 GiB reserved by 0 in-flight workspace setup(s), this step needs 2.5 GiB, and the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.';

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
}

async function containerize(issueId: string): Promise<{ status: number; body: any }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/workspaces/${issueId}/containerize`, { method: 'POST' }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(containerOpsRouteLayer), (app) => app.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      )),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

let children: FakeChild[];

beforeEach(() => {
  vi.clearAllMocks();
  children = [];
  mocks.exec.mockResolvedValue({ stdout: '', stderr: '' });
  // Only infra/new-feature exists; the workspace does not.
  mocks.existsSync.mockImplementation((path: string) => path.endsWith('/infra/new-feature'));
  mocks.spawn.mockImplementation(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  mocks.release.mockResolvedValue(undefined);
  mocks.reserveDiskFloor.mockResolvedValue({ ok: true, reservation: { release: mocks.release } });
  mocks.estimateWorkspaceDiskCost.mockResolvedValue({ hostBytes: 500, stackBytes: 0, hostSource: 'measured', stackSource: 'none' });
});

describe('POST /api/workspaces/:issueId/containerize disk admission (PAN-4961)', () => {
  it('containerize-admission.ac1: a refusal answers 507 diskLow and spawns nothing', async () => {
    mocks.reserveDiskFloor.mockResolvedValue({ ok: false, error: HELD });

    const { status, body } = await containerize('PAN-1');

    expect(status).toBe(507);
    expect(body).toMatchObject({ success: false, blocked: true, diskLow: true, error: HELD });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reserves host bytes plus at least the seed stack bytes', async () => {
    await containerize('PAN-1');

    expect(mocks.reserveDiskFloor).toHaveBeenCalledWith({ path: '/project', bytes: 2_500, label: 'containerize:pan-1' });
  });

  it('containerize-admission.ac2: releases once after ./dev all closes', async () => {
    const { status } = await containerize('PAN-1');
    expect(status).toBe(200);
    expect(mocks.release).not.toHaveBeenCalled();

    children[0].emit('close', 0);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    children[1].emit('close', 0);
    children[1].emit('error', new Error('late error after close'));
    await flush();

    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('containerize-admission.ac2: releases once when new-feature exits non-zero', async () => {
    await containerize('PAN-1');

    children[0].emit('close', 1);
    children[0].emit('error', new Error('spawn failed too'));
    await flush();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
