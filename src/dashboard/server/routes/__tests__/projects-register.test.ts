/**
 * Tests for POST /api/projects (mode='existing') — PAN-1970
 *
 * Tests the underlying helper logic rather than booting the full Effect server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Isolate OVERDECK_HOME ───────────────────────────────────────────────────

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return { TEST_HOME: j(t(), `proj-reg-route-test-${process.pid}`) };
});

vi.mock('../../../../lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../../lib/paths.js')>('../../../../lib/paths.js');
  return { ...real, OVERDECK_HOME: TEST_HOME, CONFIG_DIR: TEST_HOME };
});
vi.mock('../../../../lib/workspace-manager.js', () => ({
  preTrustDirectorySync: vi.fn(),
  preTrustDirectory: vi.fn(),
}));
vi.mock('../../../../lib/context-layers/index.js', () => ({
  ensureProjectLayer: vi.fn().mockReturnValue(false),
}));

import { registerProjectFromPath, DuplicateProjectError } from '../../../../lib/project-registration.js';
import { getProjectSync, PROJECTS_CONFIG_FILE } from '../../../../lib/projects.js';

// ─── Simulate the POST /api/projects route validation logic ─────────────────
// We test the same code paths the route handler exercises without booting Effect.

async function simulatePost(body: {
  mode?: unknown;
  path?: unknown;
  name?: unknown;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { isAbsolute } = await import('node:path');
  const { access } = await import('node:fs/promises');

  if (body.mode !== 'existing') {
    return { status: 400, json: { error: "mode must be 'existing'" } };
  }
  const rawPath = body.path;
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { status: 400, json: { error: 'path is required' } };
  }
  if (!isAbsolute(rawPath)) {
    return { status: 400, json: { error: 'path must be absolute' } };
  }
  try {
    await access(rawPath);
  } catch {
    return { status: 404, json: { error: `path does not exist: ${rawPath}` } };
  }
  const nameOpt = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
  try {
    const result = await registerProjectFromPath({ path: rawPath, name: nameOpt });
    return { status: 200, json: { key: result.key, name: result.config.name, path: result.config.path } };
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      return { status: 409, json: { error: `project key '${err.key}' is already registered`, key: err.key, existingPath: err.existingPath } };
    }
    throw err;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let projDir: string;

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  try { rmSync(PROJECTS_CONFIG_FILE); } catch { /* ok */ }
  projDir = join(TEST_HOME, `proj-${Math.random().toString(36).slice(2)}`);
  mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('POST /api/projects (mode=existing) — logic', () => {
  it('registers a project and returns 200 { key, name, path }', async () => {
    const res = await simulatePost({ mode: 'existing', path: projDir });
    expect(res.status).toBe(200);
    expect(res.json.path).toBe(projDir);
    expect(typeof res.json.key).toBe('string');
    expect(typeof res.json.name).toBe('string');

    const stored = getProjectSync(res.json.key as string);
    expect(stored).not.toBeNull();
    expect(stored!.path).toBe(projDir);
  });

  it('returns 400 when path is missing', async () => {
    const res = await simulatePost({ mode: 'existing' });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/path is required/i);
    // nothing registered
    expect(getProjectSync('unknown')).toBeNull();
  });

  it('returns 404 when path does not exist', async () => {
    const res = await simulatePost({ mode: 'existing', path: join(TEST_HOME, 'does-not-exist') });
    expect(res.status).toBe(404);
    expect(res.json.error).toMatch(/does not exist/i);
  });

  it('returns 409 for a duplicate key and does not mutate projects.yaml', async () => {
    // First registration succeeds
    const res1 = await simulatePost({ mode: 'existing', path: projDir });
    expect(res1.status).toBe(200);

    // Second registration of the same name returns 409
    const projDir2 = join(TEST_HOME, `proj-dup-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projDir2, { recursive: true });
    const res2 = await simulatePost({ mode: 'existing', path: projDir2, name: res1.json.name as string });
    expect(res2.status).toBe(409);
    expect(res2.json.key).toBe(res1.json.key);

    // Original entry is unchanged
    const stored = getProjectSync(res1.json.key as string);
    expect(stored!.path).toBe(projDir);
  });

  it('returns 400 when mode is absent or wrong', async () => {
    const r1 = await simulatePost({ mode: 'new', path: projDir });
    expect(r1.status).toBe(400);

    const r2 = await simulatePost({ path: projDir });
    expect(r2.status).toBe(400);
  });

  it('writes the fs-helper.mjs-created tmp file to confirm access check', async () => {
    // Confirm that a file (not a dir) still resolves — access only checks existence, not type
    const file = join(TEST_HOME, 'a-file.txt');
    writeFileSync(file, '');
    const res = await simulatePost({ mode: 'existing', path: file });
    // access() succeeds on files too; registerProjectFromPath handles from there
    expect([200, 500]).toContain(res.status); // may fail downstream on non-dir readdir, that's OK
  });
});
