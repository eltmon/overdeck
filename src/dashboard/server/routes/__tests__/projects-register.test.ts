/**
 * Tests for POST /api/projects (mode='existing' and mode='new') — PAN-1970
 *
 * Tests the underlying helper logic rather than booting the full Effect server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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
// Treat TEST_HOME as the home directory so home-boundary checks work with temp dirs.
vi.mock('node:os', async () => {
  const real = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...real, homedir: () => TEST_HOME };
});

import { registerProjectFromPath, DuplicateProjectError } from '../../../../lib/project-registration.js';
import { getProjectSync, PROJECTS_CONFIG_FILE } from '../../../../lib/projects.js';

// ─── Shared simulation helpers ───────────────────────────────────────────────

function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }

async function simulateExisting(body: {
  path?: unknown;
  name?: unknown;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { isAbsolute, sep } = await import('node:path');
  const { access, realpath } = await import('node:fs/promises');
  const { homedir } = await import('node:os');

  const rawPath = body.path;
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { status: 400, json: { error: 'path is required' } };
  }
  if (!isAbsolute(rawPath)) {
    return { status: 400, json: { error: 'path must be absolute' } };
  }
  try { await access(rawPath); }
  catch { return { status: 404, json: { error: `path does not exist: ${rawPath}` } }; }

  // Home-boundary check (mirrors routes/projects.ts buildHomeGuard).
  const home = homedir();
  let ch: string;
  try { ch = await realpath(home); } catch { ch = home; }
  const withinHome = (p: string) => p === ch || p.startsWith(ch.endsWith(sep) ? ch : `${ch}${sep}`);
  let canonicalPath: string;
  try { canonicalPath = await realpath(rawPath); }
  catch { return { status: 404, json: { error: `path does not exist: ${rawPath}` } }; }
  if (!withinHome(canonicalPath)) {
    return { status: 400, json: { error: 'path is outside home directory' } };
  }

  const nameOpt = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
  try {
    const result = await registerProjectFromPath({ path: canonicalPath, name: nameOpt });
    return { status: 200, json: { key: result.key, name: result.config.name, path: result.config.path } };
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      return { status: 409, json: { error: `project key '${err.key}' is already registered`, key: err.key, existingPath: err.existingPath } };
    }
    throw err;
  }
}

async function simulateNew(body: {
  parentDir?: unknown;
  name?: unknown;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { isAbsolute, join: pathJoin, sep, resolve, normalize, dirname, relative } = await import('node:path');
  const { access, mkdir, readdir, realpath } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  const rawName = body.name;
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return { status: 400, json: { error: 'name is required for mode=new' } };
  }
  const rawParent = body.parentDir;
  if (typeof rawParent !== 'string' || !rawParent.trim()) {
    return { status: 400, json: { error: 'parentDir is required for mode=new' } };
  }
  if (!isAbsolute(rawParent)) {
    return { status: 400, json: { error: 'parentDir must be absolute' } };
  }

  const name = rawName.trim();
  const key = slugify(name);

  // Reject names whose slug contains no alphanumeric characters.
  if (!key.replace(/-/g, '')) {
    return { status: 400, json: { error: 'Name must contain at least one alphanumeric character' } };
  }

  if (getProjectSync(key)) {
    return { status: 409, json: { error: `project key '${key}' is already registered` } };
  }

  // Home-boundary check (mirrors routes/projects.ts buildHomeGuard).
  // parentDir need not exist yet — climb to the nearest existing ancestor,
  // canonicalize it, then re-anchor the requested parent; mkdir -p creates the chain.
  const home = homedir();
  let ch: string;
  try { ch = await realpath(home); } catch { ch = home; }
  const withinHome = (p: string) => p === ch || p.startsWith(ch.endsWith(sep) ? ch : `${ch}${sep}`);
  const rawParentResolved = resolve(normalize(rawParent));
  let probe = rawParentResolved;
  let existingAncestor: string | null = null;
  for (;;) {
    try { existingAncestor = await realpath(probe); break; }
    catch { /* climb */ }
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  if (!existingAncestor || !withinHome(existingAncestor)) {
    return { status: 400, json: { error: 'parentDir is outside home directory' } };
  }
  const suffix = relative(probe, rawParentResolved);
  const canonicalParent = suffix ? resolve(existingAncestor, suffix) : existingAncestor;
  if (!withinHome(canonicalParent)) {
    return { status: 400, json: { error: 'parentDir is outside home directory' } };
  }

  const target = pathJoin(canonicalParent, key);

  let targetExists = false;
  try { await access(target); targetExists = true; } catch { /* ok */ }
  if (targetExists) {
    const entries = await readdir(target).catch(() => []);
    if (entries.length > 0) {
      return { status: 409, json: { error: `target directory already exists and is non-empty: ${target}` } };
    }
  }

  await mkdir(target, { recursive: true });
  await execAsync('git init', { cwd: target });

  try {
    const result = await registerProjectFromPath({ path: target, name });
    return { status: 200, json: { key: result.key, name: result.config.name, path: result.config.path } };
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      return { status: 409, json: { error: `project key '${err.key}' is already registered`, key: err.key, existingPath: err.existingPath } };
    }
    throw err;
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

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

// ─── mode='existing' tests ────────────────────────────────────────────────────

describe("POST /api/projects mode='existing'", () => {
  it('registers a project and returns 200 { key, name, path }', async () => {
    const res = await simulateExisting({ path: projDir });
    expect(res.status).toBe(200);
    expect(res.json.path).toBe(projDir);
    expect(typeof res.json.key).toBe('string');
    const stored = getProjectSync(res.json.key as string);
    expect(stored?.path).toBe(projDir);
  });

  it('returns 400 when path is missing', async () => {
    const res = await simulateExisting({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when path does not exist', async () => {
    const res = await simulateExisting({ path: join(TEST_HOME, 'no-such-dir') });
    expect(res.status).toBe(404);
  });

  it('returns 409 for a duplicate key without mutating projects.yaml', async () => {
    const res1 = await simulateExisting({ path: projDir });
    expect(res1.status).toBe(200);

    const dir2 = join(TEST_HOME, `proj2-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir2, { recursive: true });
    const res2 = await simulateExisting({ path: dir2, name: res1.json.name as string });
    expect(res2.status).toBe(409);
    expect(getProjectSync(res1.json.key as string)?.path).toBe(projDir);
  });
});

// ─── mode='new' tests ─────────────────────────────────────────────────────────

describe("POST /api/projects mode='new'", () => {
  it('creates folder + .git + registers project, returns 200 { key, name, path }', async () => {
    const parentDir = join(TEST_HOME, 'parent');
    mkdirSync(parentDir, { recursive: true });
    const name = 'my-new-app';

    const res = await simulateNew({ parentDir, name });
    expect(res.status).toBe(200);
    expect(res.json.name).toBe(name);
    expect(res.json.key).toBe('my-new-app');
    const target = join(parentDir, 'my-new-app');
    expect(res.json.path).toBe(target);

    // git init actually ran
    expect(existsSync(join(target, '.git'))).toBe(true);

    // project is registered
    expect(getProjectSync('my-new-app')?.path).toBe(target);
  });

  it('creates a non-existent in-home parent (mkdir -p) — the ~/Projects default', async () => {
    // Parent does NOT exist yet (mirrors the default ~/Projects home on a fresh machine).
    const parentDir = join(TEST_HOME, 'Projects');
    expect(existsSync(parentDir)).toBe(false);
    const name = 'fresh-app';

    const res = await simulateNew({ parentDir, name });
    expect(res.status).toBe(200);
    const target = join(parentDir, 'fresh-app');
    expect(res.json.path).toBe(target);
    // Both the parent chain and the project folder were created.
    expect(existsSync(parentDir)).toBe(true);
    expect(existsSync(join(target, '.git'))).toBe(true);
    expect(getProjectSync('fresh-app')?.path).toBe(target);
  });

  it('rejects a non-existent parent whose nearest existing ancestor is outside home', async () => {
    // A path under /tmp (outside the mocked TEST_HOME) that does not exist: the
    // climb must land on an existing ancestor outside home and reject — never
    // create anything outside home.
    const { tmpdir } = await import('node:os');
    const outsideParent = join(tmpdir(), `outside-nonexist-${process.pid}`, 'deep', 'nope');
    const res = await simulateNew({ parentDir: outsideParent, name: 'escape-app' });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/outside home/i);
    expect(existsSync(outsideParent)).toBe(false);
  });

  it('returns 409 for a non-empty existing target without any fs/registry change', async () => {
    const parentDir = join(TEST_HOME, 'parent2');
    mkdirSync(parentDir, { recursive: true });
    const name = 'occupied';
    const target = join(parentDir, 'occupied');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'existing.txt'), 'content'); // non-empty

    const res = await simulateNew({ parentDir, name });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/non-empty/i);
    // nothing registered
    expect(getProjectSync('occupied')).toBeNull();
  });

  it('returns 409 for a dup key before any mkdir/git init (no orphan folder)', async () => {
    const parentDir = join(TEST_HOME, 'parent3');
    mkdirSync(parentDir, { recursive: true });
    // Pre-register the key
    const dirA = join(TEST_HOME, 'existing-app');
    mkdirSync(dirA, { recursive: true });
    await simulateExisting({ path: dirA, name: 'new-app' });

    const res = await simulateNew({ parentDir, name: 'new-app' });
    expect(res.status).toBe(409);
    // No orphan folder was created
    expect(existsSync(join(parentDir, 'new-app'))).toBe(false);
  });

  it('no execSync import in routes/projects.ts', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../projects.ts', import.meta.url).pathname,
      'utf-8',
    );
    expect(src).not.toMatch(/execSync/);
  });

  it('returns 400 when name contains no alphanumeric characters (empty slug)', async () => {
    const parentDir = join(TEST_HOME, 'parent-slug');
    mkdirSync(parentDir, { recursive: true });
    const res = await simulateNew({ parentDir, name: '!!!' });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/alphanumeric/i);
  });

  it('returns 400 when parentDir is outside home directory', async () => {
    // Use a real temp dir outside TEST_HOME as the "outside home" path.
    const { tmpdir } = await import('node:os');
    const outsideParent = join(tmpdir(), `outside-${process.pid}`);
    mkdirSync(outsideParent, { recursive: true });
    try {
      const res = await simulateNew({ parentDir: outsideParent, name: 'my-app' });
      // The route rejects because outsideParent is not under TEST_HOME (the mocked home).
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/outside home/i);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(outsideParent, { recursive: true, force: true });
    }
  });
});

// ─── mode='existing' home-boundary tests ─────────────────────────────────────

describe("POST /api/projects mode='existing' — home boundary", () => {
  it('returns 400 when path is outside home directory', async () => {
    const { tmpdir } = await import('node:os');
    const outsideDir = join(tmpdir(), `outside-existing-${process.pid}`);
    mkdirSync(outsideDir, { recursive: true });
    try {
      const res = await simulateExisting({ path: outsideDir });
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/outside home/i);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
