/**
 * PAN-3330 WI-2 AC-2/AC-3/AC-4 — persistence invariants, proven against the
 * real creation core and the real workspace doors rather than mocks.
 *
 * The sibling suite (workspace-registry-create.test.ts) mocks the core to pin
 * status codes and forwarding; that cannot show that resolve leaves the disk
 * and the registry untouched, that create produces a resolver-readable row, or
 * that relocate actually moves the stored path. Only the dashboard mutation
 * guard is stubbed here, because supplying a real CSRF session is orthogonal
 * to what these cases prove.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';
import { registerProjectSync, unregisterProjectSync } from '../../../src/lib/projects.js';
import { getWorkspaceById, listWorkspaces } from '../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';
import { clearParentBranchCache } from '../../../src/lib/workspaces/create.js';

vi.mock('../../../src/dashboard/server/routes/dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: () => null,
}));

import { workspaceRegistryRouteLayer } from '../../../src/dashboard/server/routes/workspace-registry.js';

let odb: OverdeckTestDb;
let projectRoot: string;
let targetDir: string;
const PROJECT_KEY = 'pan-3330-registry-integration';

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
  );
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(workspaceRegistryRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

function worktreeList(): string {
  return execFileSync('git', ['worktree', 'list'], { cwd: projectRoot, encoding: 'utf-8' });
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  clearParentBranchCache();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-3330-registry-integration-'));
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
  writeFileSync(join(projectRoot, 'README.md'), 'root\n', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-m', 'init', '--quiet'], { cwd: projectRoot });
  registerProjectSync(PROJECT_KEY, { name: 'Registry integration project', path: projectRoot });
  targetDir = mkdtempSync(join(tmpdir(), 'pan-3330-registry-target-'));
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  clearParentBranchCache();
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('POST /api/workspace-registry/resolve leaves the world untouched (AC-2)', () => {
  it('creates no worktree and no registry row across all three modes', async () => {
    const worktreesBefore = worktreeList();
    const rowsBefore = listWorkspaces({ projectId: PROJECT_KEY }).length;

    const shared = await call('POST', '/api/workspace-registry/resolve', { project: PROJECT_KEY, name: 'shared-probe' });
    const isolated = await call('POST', '/api/workspace-registry/resolve', { project: PROJECT_KEY, name: 'iso-probe', isolated: true });
    const targeted = await call('POST', '/api/workspace-registry/resolve', { project: PROJECT_KEY, name: 'target-probe', targetPath: targetDir });

    expect([shared.status, isolated.status, targeted.status]).toEqual([200, 200, 200]);
    expect(isolated.body).toMatchObject({ branchName: 'scratch/iso-probe', wouldCreateWorktree: true });
    expect(targeted.body).toMatchObject({ path: targetDir, wouldCreateWorktree: false });

    expect(worktreeList()).toBe(worktreesBefore);
    expect(listWorkspaces({ projectId: PROJECT_KEY })).toHaveLength(rowsBefore);
    expect(existsSync(join(projectRoot, 'workspaces', 'scratch-iso-probe'))).toBe(false);
  });

  it('reports findings for an invalid name without writing anything', async () => {
    const result = await call('POST', '/api/workspace-registry/resolve', { project: PROJECT_KEY, name: 'bad/name' });

    expect(result.status).toBe(200);
    expect(result.body.findings).toEqual([
      expect.objectContaining({ field: 'name', code: 'invalid-name' }),
    ]);
    expect(listWorkspaces({ projectId: PROJECT_KEY })).toHaveLength(0);
  });
});

describe('POST /api/workspace-registry persists a real row (AC-3)', () => {
  it('returns 201 and the row is readable through the resolver door', async () => {
    const result = await call('POST', '/api/workspace-registry', { project: PROJECT_KEY, name: 'lens' });

    expect(result.status).toBe(201);
    const id = result.body.id as string;
    const row = getWorkspaceById(id);
    expect(row).toMatchObject({ projectId: PROJECT_KEY, kind: 'scratch', name: 'lens', path: projectRoot });
  });

  it('creates the worktree and branch for an isolated intent', async () => {
    const result = await call('POST', '/api/workspace-registry', { project: PROJECT_KEY, name: 'iso', isolated: true });

    expect(result.status).toBe(201);
    expect(existsSync(join(projectRoot, 'workspaces', 'scratch-iso'))).toBe(true);
    expect(worktreeList()).toMatch(/scratch-iso/);
    expect(getWorkspaceById(result.body.id as string)?.branchName).toBe('scratch/iso');
  });

  it('rejects an invalid intent with 422 and writes no row', async () => {
    const result = await call('POST', '/api/workspace-registry', { project: PROJECT_KEY, name: 'bad/name' });

    expect(result.status).toBe(422);
    expect(result.body.findings).toEqual([expect.objectContaining({ code: 'invalid-name' })]);
    expect(listWorkspaces({ projectId: PROJECT_KEY })).toHaveLength(0);
  });

  it('bootstraps the project main workspace when asked (D-7/FR-4)', async () => {
    const result = await call('POST', '/api/workspace-registry', { project: PROJECT_KEY, bootstrapMain: true });

    expect(result.status).toBe(201);
    const row = getWorkspaceById(result.body.id as string);
    expect(row).toMatchObject({ kind: 'main', name: 'main', path: projectRoot });
  });
});

describe('POST /api/workspace-registry/:id/relocate moves the stored path (AC-4)', () => {
  async function scratchRow(): Promise<string> {
    upsertProjectFromConfig(PROJECT_KEY, { name: 'Registry integration project', path: projectRoot });
    return createWorkspace({ projectId: PROJECT_KEY, kind: 'scratch', name: 'lens', path: projectRoot });
  }

  it('updates the row path and re-detects git presence', async () => {
    const id = await scratchRow();

    const result = await call('POST', `/api/workspace-registry/${id}/relocate`, { path: targetDir });

    expect(result.status).toBe(200);
    expect(getWorkspaceById(id)).toMatchObject({ path: targetDir, isGitRepository: false });
  });

  it('rejects a path that does not exist, leaving the row untouched', async () => {
    const id = await scratchRow();

    const result = await call('POST', `/api/workspace-registry/${id}/relocate`, { path: join(targetDir, 'nope') });

    expect(result.status).toBe(409);
    expect(String(result.body.error)).toMatch(/existing directory/);
    expect(getWorkspaceById(id)?.path).toBe(projectRoot);
  });

  it('rejects a regular file, leaving the row untouched', async () => {
    const id = await scratchRow();
    const filePath = join(targetDir, 'a-file.txt');
    writeFileSync(filePath, 'x', 'utf-8');

    const result = await call('POST', `/api/workspace-registry/${id}/relocate`, { path: filePath });

    expect(result.status).toBe(409);
    expect(getWorkspaceById(id)?.path).toBe(projectRoot);
  });

  it('stores a relative path as its resolved absolute form', async () => {
    const id = await scratchRow();

    const result = await call('POST', `/api/workspace-registry/${id}/relocate`, { path: '.' });

    expect(result.status).toBe(200);
    expect(getWorkspaceById(id)?.path).toBe(process.cwd());
  });

  it('refuses to relocate main without force, then permits it with force', async () => {
    upsertProjectFromConfig(PROJECT_KEY, { name: 'Registry integration project', path: projectRoot });
    const id = await createWorkspace({ projectId: PROJECT_KEY, kind: 'main', name: 'main', path: projectRoot });

    const refused = await call('POST', `/api/workspace-registry/${id}/relocate`, { path: targetDir });
    expect(refused.status).toBe(409);
    expect(getWorkspaceById(id)?.path).toBe(projectRoot);

    const forced = await call('POST', `/api/workspace-registry/${id}/relocate`, { path: targetDir, force: true });
    expect(forced.status).toBe(200);
    expect(getWorkspaceById(id)?.path).toBe(targetDir);
  });
});

describe('POST /api/workspace-registry/:id/archive keeps its pre-existing contract', () => {
  it('archives a scratch workspace', async () => {
    upsertProjectFromConfig(PROJECT_KEY, { name: 'Registry integration project', path: projectRoot });
    const id = await createWorkspace({ projectId: PROJECT_KEY, kind: 'scratch', name: 'lens', path: projectRoot });

    const result = await call('POST', `/api/workspace-registry/${id}/archive`, { archived: true });

    expect(result.status).toBe(200);
    expect(getWorkspaceById(id)?.isArchived).toBe(true);
  });

  // No-loss (NFR-4 / NonGoal 5): this route's behavior for every kind predates
  // the PR and must survive it unchanged, so main stays archivable here.
  it('still archives a main workspace, as it did before this feature', async () => {
    upsertProjectFromConfig(PROJECT_KEY, { name: 'Registry integration project', path: projectRoot });
    const id = await createWorkspace({ projectId: PROJECT_KEY, kind: 'main', name: 'main', path: projectRoot });

    const result = await call('POST', `/api/workspace-registry/${id}/archive`, { archived: true });

    expect(result.status).toBe(200);
    expect(getWorkspaceById(id)?.isArchived).toBe(true);
  });
});

describe('GET /api/workspace-registry/project-targets reads real config', () => {
  it('returns the project primary path', async () => {
    const result = await call('GET', `/api/workspace-registry/project-targets?project=${PROJECT_KEY}`);

    expect(result.status).toBe(200);
    expect(result.body.primaryPath).toBe(projectRoot);
  });
});
