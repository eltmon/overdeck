import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_TOKEN_HEADER } from '../../internal-token.js';
import {
  findPendingPromotionCandidates,
  reconcilePendingPromotions,
} from '../pending-promotion-reconciler.js';

const NOW = new Date('2026-07-28T18:00:00.000Z');
const roots: string[] = [];

type WorkspaceOptions = {
  marker?: Partial<{
    noPrd: boolean;
    finalizedAt: string;
    patrolAttempts: number;
  }> | false;
  specMtime?: Date;
  strike?: boolean;
  promotionIntent?: 'automatic' | 'manual';
};

function createProject(): { key: string; config: { name: string; path: string } } {
  const path = mkdtempSync(join(tmpdir(), 'pending-promotion-project-'));
  roots.push(path);
  mkdirSync(join(path, 'workspaces'), { recursive: true });
  return { key: 'overdeck', config: { name: 'Overdeck', path } };
}

function createWorkspace(
  projectPath: string,
  issueId: string,
  options: WorkspaceOptions = {},
): { workspacePath: string; markerPath: string; specPath: string } {
  const suffix = options.strike ? '-strike' : '';
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}${suffix}`);
  const runtimeDir = join(workspacePath, '.overdeck');
  mkdirSync(runtimeDir, { recursive: true });
  const specPath = join(runtimeDir, 'spec.vbrief.json');
  writeFileSync(specPath, JSON.stringify({
    xBRIEFInfo: { version: '0.8', created: '2026-07-28T17:00:00.000Z' },
    plan: {
      id: issueId.toLowerCase(),
      title: 'Pending promotion',
      status: 'proposed',
      updated: '2026-07-28T17:00:00.000Z',
      metadata: {
        canonicalFilename: `2026-07-28-${issueId}-pending-promotion.xbrief.json`,
        ...(options.promotionIntent ? { promotionIntent: options.promotionIntent } : {}),
      },
      items: [{ id: 'item', title: 'Item', status: 'pending' }],
    },
  }, null, 2));
  if (options.specMtime) utimesSync(specPath, options.specMtime, options.specMtime);

  const markerPath = join(runtimeDir, 'pending-promotion.json');
  if (options.marker !== false) {
    writeFileSync(markerPath, JSON.stringify({
      version: '1',
      issueId,
      canonicalFilename: `2026-07-28-${issueId}-pending-promotion.xbrief.json`,
      noPrd: options.marker?.noPrd ?? false,
      autoSpawnRequested: false,
      finalizedAt: options.marker?.finalizedAt ?? '2026-07-28T17:00:00.000Z',
      lastError: 'Dashboard unreachable',
      lastAttemptAt: '2026-07-28T17:00:15.000Z',
      patrolAttempts: options.marker?.patrolAttempts ?? 0,
    }, null, 2));
  }
  return { workspacePath, markerPath, specPath };
}

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseOptions(project: ReturnType<typeof createProject>) {
  return {
    projects: [project],
    clock: () => NOW,
    dashboardOrigin: 'http://127.0.0.1:3011',
    getInternalToken: () => 'test-internal-token',
    findPromotedSpec: vi.fn(async () => null),
    isClosed: vi.fn(async () => false),
    recordNeedsYou: vi.fn(async () => undefined),
    emitActivity: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('pending-promotion reconciler', () => {
  it('forwards noPrd and removes the marker after HTTP 200 promotion', async () => {
    const project = createProject();
    const workspace = createWorkspace(project.config.path, 'PAN-3229', {
      marker: { noPrd: true },
    });
    const fetchMock = vi.fn(async () => response(200, { success: true }));
    const options = { ...baseOptions(project), fetch: fetchMock };

    const actions = await reconcilePendingPromotions(options);

    expect(actions).toEqual(['Recovered pending planning promotion for PAN-3229']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:3011/api/issues/PAN-3229/complete-planning');
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3011',
        [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
      },
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      noPrd: true,
      startedBy: 'pending-promotion-reconciler',
    });
    expect(existsSync(workspace.markerPath)).toBe(false);
    expect(options.emitActivity).toHaveBeenCalledTimes(1);
  });

  it('clears an already-promoted marker without POSTing', async () => {
    const project = createProject();
    const workspace = createWorkspace(project.config.path, 'PAN-3229');
    const fetchMock = vi.fn();
    const options = {
      ...baseOptions(project),
      fetch: fetchMock,
      findPromotedSpec: vi.fn(async () => ({ path: 'specs/promoted.xbrief.json' })),
    };

    const actions = await reconcilePendingPromotions(options);

    expect(actions).toEqual(['Cleared resolved pending-promotion marker for PAN-3229']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(workspace.markerPath)).toBe(false);
  });

  it.each([
    ['HTTP 202', response(202, { inFlight: true })],
    ['a skipped response', response(200, { skipped: 'pending-ask-user-question' })],
  ])('preserves the marker unchanged for %s', async (_label, deferredResponse) => {
    const project = createProject();
    const workspace = createWorkspace(project.config.path, 'PAN-3229');
    const before = readFileSync(workspace.markerPath, 'utf-8');
    const options = {
      ...baseOptions(project),
      fetch: vi.fn(async () => deferredResponse),
    };

    expect(await reconcilePendingPromotions(options)).toEqual([]);
    expect(readFileSync(workspace.markerPath, 'utf-8')).toBe(before);
    expect(options.recordNeedsYou).not.toHaveBeenCalled();
  });

  it('skips young markers, closed issues, and strike workspaces', async () => {
    const project = createProject();
    const young = createWorkspace(project.config.path, 'PAN-3229', {
      marker: { finalizedAt: '2026-07-28T17:59:30.000Z' },
    });
    const closed = createWorkspace(project.config.path, 'PAN-3230');
    const strike = createWorkspace(project.config.path, 'PAN-3231', { strike: true });
    const fetchMock = vi.fn();
    const options = {
      ...baseOptions(project),
      fetch: fetchMock,
      isClosed: vi.fn(async (issueId: string) => issueId === 'PAN-3230'),
    };

    expect(await reconcilePendingPromotions(options)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(young.markerPath)).toBe(true);
    expect(existsSync(closed.markerPath)).toBe(true);
    expect(existsSync(strike.markerPath)).toBe(true);
  });

  it('persists failed attempts and trips needs-you on the fifth failure', async () => {
    const project = createProject();
    const workspace = createWorkspace(project.config.path, 'PAN-3229', {
      marker: { patrolAttempts: 4 },
    });
    const options = {
      ...baseOptions(project),
      fetch: vi.fn(async () => response(500, { error: 'promotion failed' })),
    };

    const actions = await reconcilePendingPromotions(options);

    expect(actions).toEqual([
      'Pending planning promotion for PAN-3229 failed attempt 5: promotion failed',
    ]);
    expect(JSON.parse(readFileSync(workspace.markerPath, 'utf-8'))).toMatchObject({
      patrolAttempts: 5,
      lastError: 'promotion failed',
      lastAttemptAt: NOW.toISOString(),
      finalizedAt: '2026-07-28T17:00:00.000Z',
    });
    expect(options.recordNeedsYou).toHaveBeenCalledWith(
      'PAN-3229',
      'pending-promotion',
      '2026-07-28T17:00:00.000Z',
      expect.stringContaining('pan plan done PAN-3229'),
    );
  });

  it('keeps a manually finalized markerless workspace unpromoted', async () => {
    const project = createProject();
    createWorkspace(project.config.path, 'PAN-3229', {
      marker: false,
      specMtime: new Date('2026-07-28T17:50:00.000Z'),
      promotionIntent: 'manual',
    });
    const options = {
      ...baseOptions(project),
      fetch: vi.fn(),
    };

    expect(await findPendingPromotionCandidates(options)).toEqual([]);
    expect(await reconcilePendingPromotions(options)).toEqual([]);
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it('uses injected marker I/O for discovery, failure persistence, and cleanup', async () => {
    const project = createProject();
    const recovered = createWorkspace(project.config.path, 'PAN-3229');
    const failed = createWorkspace(project.config.path, 'PAN-3230');
    const markerIo = {
      read: vi.fn(async (path: string) => JSON.parse(readFileSync(path, 'utf-8'))),
      write: vi.fn(async (path: string, marker: unknown) => {
        writeFileSync(path, JSON.stringify(marker));
      }),
      remove: vi.fn(async (path: string) => {
        rmSync(path, { force: true });
      }),
    };
    const options = {
      ...baseOptions(project),
      markerIo,
      fetch: vi.fn(async (url: URL | RequestInfo) =>
        String(url).includes('PAN-3229')
          ? response(200, { success: true })
          : response(500, { error: 'promotion failed' }),
      ),
    };

    const actions = await reconcilePendingPromotions(options);

    expect(actions).toEqual([
      'Recovered pending planning promotion for PAN-3229',
      'Pending planning promotion for PAN-3230 failed attempt 1: promotion failed',
    ]);
    expect(markerIo.read).toHaveBeenCalledWith(recovered.markerPath, 'PAN-3229');
    expect(markerIo.read).toHaveBeenCalledWith(failed.markerPath, 'PAN-3230');
    expect(markerIo.remove).toHaveBeenCalledWith(recovered.markerPath);
    expect(markerIo.write).toHaveBeenCalledWith(
      failed.markerPath,
      expect.objectContaining({ issueId: 'PAN-3230', patrolAttempts: 1 }),
    );
  });

  it('detects an old markerless proposed workspace spec and drives promotion', async () => {
    const project = createProject();
    const oldMtime = new Date('2026-07-28T17:50:00.000Z');
    const workspace = createWorkspace(project.config.path, 'PAN-3229', {
      marker: false,
      specMtime: oldMtime,
    });
    const options = {
      ...baseOptions(project),
      fetch: vi.fn(async () => response(200, { success: true })),
    };

    const candidates = await findPendingPromotionCandidates(options);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      issueId: 'PAN-3229',
      marker: null,
      finalizedAt: oldMtime.toISOString(),
    });

    expect(await reconcilePendingPromotions(options)).toEqual([
      'Recovered pending planning promotion for PAN-3229',
    ]);
    expect(options.fetch).toHaveBeenCalledTimes(1);
    expect(existsSync(workspace.markerPath)).toBe(false);
  });
});
