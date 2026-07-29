import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { planFinalizeCommand } from '../../../cli/commands/plan-finalize.js';
import { reconcilePendingPromotions } from '../pending-promotion-reconciler.js';

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

const roots: string[] = [];
const originalOverdeckHome = process.env.OVERDECK_HOME;

function createWorkspace(): { projectPath: string; workspacePath: string; markerPath: string } {
  const projectPath = mkdtempSync(join(tmpdir(), 'pending-promotion-convergence-'));
  roots.push(projectPath);
  const workspacePath = join(projectPath, 'workspaces', 'feature-pan-3229');
  const runtimeDir = join(workspacePath, '.overdeck');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'spec.vbrief.json'), JSON.stringify({
    xBRIEFInfo: {
      version: '0.8',
      created: '2026-07-28T18:00:00.000Z',
      author: 'test',
      description: 'Pending promotion convergence test',
    },
    plan: {
      id: 'pan-3229',
      title: 'Pending promotion convergence test',
      status: 'approved',
      sequence: 0,
      created: '2026-07-28T18:00:00.000Z',
      updated: '2026-07-28T18:00:00.000Z',
      items: [{
        id: 'converge',
        title: 'Converge promotion',
        status: 'pending',
        metadata: {
          files_scope: ['src/lib/cloister/pending-promotion-reconciler.ts'],
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
    projectPath,
    workspacePath,
    markerPath: join(runtimeDir, 'pending-promotion.json'),
  };
}

function mockProcessExit(): void {
  vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`EXIT:${code}`);
  }) as typeof process.exit);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T18:00:00.000Z'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('pending-promotion convergence', () => {
  it('recovers a finalize outage in one reconciler pass and remains idempotent', async () => {
    const { projectPath, workspacePath, markerPath } = createWorkspace();
    process.env.OVERDECK_HOME = projectPath;
    const finalizeFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', finalizeFetch);
    mockProcessExit();

    const finalize = planFinalizeCommand({
      workspace: workspacePath,
      json: true,
      prd: false,
      qualityLint: false,
    }).catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(15_000);

    expect((await finalize).message).toBe('EXIT:1');
    expect(finalizeFetch).toHaveBeenCalledTimes(5);
    expect(existsSync(markerPath)).toBe(true);

    let promoted = false;
    const promotionFetch = vi.fn(async () => {
      promoted = true;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const options = {
      projects: [{ key: 'overdeck', config: { name: 'Overdeck', path: projectPath } }],
      clock: () => new Date('2026-07-28T18:02:01.000Z'),
      fetch: promotionFetch,
      dashboardOrigin: 'http://127.0.0.1:3011',
      getInternalToken: () => 'test-token',
      findPromotedSpec: vi.fn(async () => promoted ? { path: 'specs/promoted.xbrief.json' } : null),
      isClosed: vi.fn(async () => false),
      emitActivity: vi.fn(),
    };

    expect(await reconcilePendingPromotions(options)).toEqual([
      'Recovered pending planning promotion for PAN-3229',
    ]);
    expect(promotionFetch).toHaveBeenCalledTimes(1);
    expect(String(promotionFetch.mock.calls[0]![0])).toContain('/api/issues/PAN-3229/complete-planning');
    expect(existsSync(markerPath)).toBe(false);

    expect(await reconcilePendingPromotions(options)).toEqual([]);
    expect(promotionFetch).toHaveBeenCalledTimes(1);
  });
});
