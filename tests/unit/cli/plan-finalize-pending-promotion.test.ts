import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  planFinalizeCommand,
  writePendingPromotionMarker,
  type PendingPromotionMarker,
} from '../../../src/cli/commands/plan-finalize.js';
import { reconcilePendingPromotions } from '../../../src/lib/cloister/pending-promotion-reconciler.js';
import { PENDING_PROMOTION_FILENAME } from '../../../src/lib/pan-dir/types.js';

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

const FIXED_NOW = '2026-07-28T18:00:00.000Z';
const originalOverdeckHome = process.env.OVERDECK_HOME;
const roots: string[] = [];

function createWorkspace(specDirname: '.overdeck' | '.pan' = '.overdeck'): { root: string; workspacePath: string; markerPath: string; specPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'plan-finalize-pending-promotion-'));
  roots.push(root);
  const workspacePath = join(root, 'workspaces', 'feature-pan-3229');
  const specDir = join(workspacePath, specDirname);
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'spec.vbrief.json');
  writeFileSync(specPath, JSON.stringify({
    xBRIEFInfo: {
      version: '0.8',
      created: '2026-07-28T17:00:00.000Z',
      author: 'test',
      description: 'Pending promotion test plan',
    },
    plan: {
      id: 'pan-3229',
      title: 'Pending promotion test plan',
      status: 'approved',
      sequence: 0,
      created: '2026-07-28T17:00:00.000Z',
      updated: '2026-07-28T17:00:00.000Z',
      items: [{
        id: 'marker',
        title: 'Write marker',
        status: 'pending',
        metadata: {
          files_scope: ['src/cli/commands/plan-finalize.ts'],
          files_scope_confidence: 'high',
          readiness: 'ready',
          verify_commands: ['npm test'],
          expected_outputs: ['test passes'],
        },
      }],
      edges: [],
    },
  }, null, 2));
  return {
    root,
    workspacePath,
    markerPath: join(workspacePath, '.overdeck', PENDING_PROMOTION_FILENAME),
    specPath,
  };
}

function captureJson(log: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const line = log.mock.calls
    .map(args => String(args[0]))
    .find(value => value.startsWith('{') && value.includes('"canonicalFilename"'));
  expect(line).toBeDefined();
  return JSON.parse(line!);
}

function mockProcessExit(): void {
  vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`EXIT:${code}`);
  }) as typeof process.exit);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('plan finalize pending-promotion marker', () => {
  it('writes a durable marker and reports deferred promotion after connection retries fail', async () => {
    const { root, workspacePath, markerPath } = createWorkspace();
    process.env.OVERDECK_HOME = root;
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    mockProcessExit();
    const log = vi.mocked(console.log);

    const finalize = planFinalizeCommand({
      workspace: workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
    }).catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(15_000);

    expect((await finalize).message).toBe('EXIT:1');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as PendingPromotionMarker;
    expect(marker).toMatchObject({
      version: '1',
      issueId: 'PAN-3229',
      noPrd: true,
      autoSpawnRequested: false,
      finalizedAt: FIXED_NOW,
      lastAttemptAt: '2026-07-28T18:00:15.000Z',
      patrolAttempts: 0,
    });
    expect(marker.canonicalFilename).toMatch(/PAN-3229/);
    expect(marker.lastError).toContain('ECONNREFUSED');

    expect(captureJson(log)).toMatchObject({
      success: false,
      promoted: false,
      promotionDeferred: true,
    });
  });

  it('creates the runtime directory when a legacy workspace only has .pan/spec.vbrief.json', async () => {
    const { root, workspacePath, markerPath } = createWorkspace('.pan');
    process.env.OVERDECK_HOME = root;
    expect(() => readFileSync(markerPath, 'utf-8')).toThrow();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    mockProcessExit();

    const finalize = planFinalizeCommand({
      workspace: workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
    }).catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(15_000);

    expect((await finalize).message).toBe('EXIT:1');
    expect(JSON.parse(readFileSync(markerPath, 'utf-8'))).toMatchObject({
      version: '1',
      issueId: 'PAN-3229',
      patrolAttempts: 0,
    });
  });

  it('names the deacon recovery owner in human output while preserving exit code 1', async () => {
    const { root, workspacePath } = createWorkspace();
    process.env.OVERDECK_HOME = root;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    mockProcessExit();
    const log = vi.mocked(console.log);

    const finalize = planFinalizeCommand({
      workspace: workspacePath,
      prd: false,
      qualityLint: false,
    }).catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(15_000);

    expect((await finalize).message).toBe('EXIT:1');
    const output = log.mock.calls.map(args => String(args[0])).join('\n');
    expect(output).toContain('Promotion deferred');
    expect(output).toContain('the deacon will complete promotion automatically');
    expect(output).toContain('Manual fallback: pan plan done PAN-3229.');
  });

  it('does not write a marker when promotion succeeds or is explicitly skipped', async () => {
    const successful = createWorkspace();
    process.env.OVERDECK_HOME = successful.root;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'promoted' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.mocked(console.log);

    await planFinalizeCommand({
      workspace: successful.workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
    });

    expect(() => readFileSync(successful.markerPath, 'utf-8')).toThrow();
    expect(captureJson(log)).toMatchObject({
      success: true,
      promoted: true,
      promotionDeferred: false,
    });

    log.mockClear();
    fetchMock.mockClear();
    const skipped = createWorkspace();
    process.env.OVERDECK_HOME = skipped.root;
    await planFinalizeCommand({
      workspace: skipped.workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
      promote: false,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => readFileSync(skipped.markerPath, 'utf-8')).toThrow();
    expect(captureJson(log)).toMatchObject({
      success: true,
      promoted: false,
      promotionDeferred: false,
    });
  });

  it('does not reconcile a deliberately unpromoted plan after the markerless grace period', async () => {
    const skipped = createWorkspace();
    process.env.OVERDECK_HOME = skipped.root;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await planFinalizeCommand({
      workspace: skipped.workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
      promote: false,
    });
    utimesSync(skipped.specPath, new Date(FIXED_NOW), new Date(FIXED_NOW));
    vi.setSystemTime(new Date('2026-07-28T18:06:00.000Z'));

    expect(await reconcilePendingPromotions({
      projects: [{ key: 'overdeck', config: { name: 'Overdeck', path: skipped.root } }],
      clock: () => new Date(),
      fetch: fetchMock,
      findPromotedSpec: vi.fn(async () => null),
      isClosed: vi.fn(async () => false),
      getInternalToken: () => 'test-token',
    })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(skipped.specPath, 'utf-8'))).toMatchObject({
      plan: { metadata: { promotionIntent: 'manual' } },
    });
  });

  it('reports marker persistence failures through normal JSON and human output', async () => {
    const jsonWorkspace = createWorkspace();
    process.env.OVERDECK_HOME = jsonWorkspace.root;
    mkdirSync(`${jsonWorkspace.markerPath}.tmp`);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    mockProcessExit();
    const log = vi.mocked(console.log);

    const jsonFinalize = planFinalizeCommand({
      workspace: jsonWorkspace.workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
    }).catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(15_000);

    expect((await jsonFinalize).message).toBe('EXIT:1');
    expect(captureJson(log)).toMatchObject({
      success: false,
      promoted: false,
      promotionDeferred: false,
      promotionMarkerError: expect.any(String),
    });

    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockProcessExit();
    const humanWorkspace = createWorkspace();
    process.env.OVERDECK_HOME = humanWorkspace.root;
    mkdirSync(`${humanWorkspace.markerPath}.tmp`);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const humanLog = vi.mocked(console.log);

    const humanFinalize = planFinalizeCommand({
      workspace: humanWorkspace.workspacePath,
      prd: false,
      qualityLint: false,
    }).catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(15_000);

    expect((await humanFinalize).message).toBe('EXIT:1');
    const output = humanLog.mock.calls.map(args => String(args[0])).join('\n');
    expect(output).toContain('pending-promotion marker could not be written');
    expect(output).toContain('Automatic recovery is unavailable');
    expect(output).toContain('Marker error:');
  });

  it('keeps pending-promotion.json out of git status', () => {
    const root = mkdtempSync(join(tmpdir(), 'pending-promotion-gitignore-'));
    roots.push(root);
    mkdirSync(join(root, '.overdeck'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), readFileSync(resolve(process.cwd(), '.gitignore'), 'utf-8'));
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });

    writePendingPromotionMarker(root, {
      version: '1',
      issueId: 'PAN-3229',
      canonicalFilename: '2026-07-28-PAN-3229-test.xbrief.json',
      noPrd: false,
      autoSpawnRequested: false,
      finalizedAt: FIXED_NOW,
      lastError: 'Dashboard unreachable',
      lastAttemptAt: FIXED_NOW,
      patrolAttempts: 0,
    });

    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--', '.overdeck/pending-promotion.json'],
      { cwd: root, encoding: 'utf-8' },
    );
    expect(status).toBe('');
  });
});
