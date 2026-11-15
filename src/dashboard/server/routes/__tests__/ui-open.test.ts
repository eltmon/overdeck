import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpServerResponse } from 'effect/unstable/http';
import { handleUiOpen, type UiOpenDeps } from '../ui-open.js';

let base: string;
let project: string;

async function call(body: Record<string, unknown>, overrides: Partial<UiOpenDeps> = {}) {
  const publish = vi.fn(() => 3);
  const response = await handleUiOpen(body, {
    listProjects: async () => [{ key: 'demo', path: project }],
    listScratch: async () => [],
    resolveRoot: async (rootId) => ({ absPath: project, projectKey: rootId.slice('project:'.length) }),
    publish,
    ...overrides,
  });
  return { status: response.status, body: JSON.parse(await HttpServerResponse.toWeb(response).text()), publish };
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'ui-open-')));
  project = join(base, 'demo');
  mkdirSync(join(project, 'docs', 'guide'), { recursive: true });
  writeFileSync(join(project, 'README.md'), '# demo\n');
  mkdirSync(join(base, 'elsewhere'));
  writeFileSync(join(base, 'elsewhere', 'note.txt'), 'x');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('POST /api/ui/open', () => {
  it('resolves a folder in a project to a POSIX relPath and publishes once', async () => {
    const result = await call({ path: join(project, 'docs', 'guide') });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ projectKey: 'demo', rootId: 'project:demo', relPath: 'docs/guide', kind: 'dir', delivered: 3 });
    expect(result.publish).toHaveBeenCalledTimes(1);
    expect(result.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-path', resolution: expect.objectContaining({ relPath: 'docs/guide' }) }));
  });

  it('passes a file line and column through, and maps the root itself to an empty relPath', async () => {
    const file = await call({ path: join(project, 'README.md'), line: 10, column: 2 });
    expect(file.body).toMatchObject({ kind: 'file', relPath: 'README.md', line: 10, column: 2 });
    const root = await call({ path: project });
    expect(root.body).toMatchObject({ kind: 'dir', relPath: '' });
  });

  it('with dryRun answers 200 with delivered 0 and publishes nothing', async () => {
    const result = await call({ path: join(project, 'docs'), dryRun: true });
    expect(result.status).toBe(200);
    expect(result.body.delivered).toBe(0);
    expect(result.publish).not.toHaveBeenCalled();
  });

  it('answers outside-projects with a suggestion naming the folder, or a file’s parent', async () => {
    const file = await call({ path: join(base, 'elsewhere', 'note.txt') });
    expect(file.status).toBe(404);
    expect(file.body).toEqual({
      error: 'outside-projects',
      path: join(base, 'elsewhere', 'note.txt'),
      kind: 'file',
      suggestion: `pan project add ${join(base, 'elsewhere')}`,
    });
    const dir = await call({ path: join(base, 'elsewhere') });
    expect(dir.body.suggestion).toBe(`pan project add ${join(base, 'elsewhere')}`);
    expect(file.publish).not.toHaveBeenCalled();
  });

  it('rejects a relative path and a bad position with 400', async () => {
    expect((await call({ path: 'docs' })).body).toEqual({ error: 'path-must-be-absolute' });
    expect((await call({})).status).toBe(400);
    const bad = await call({ path: project, line: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'invalid-position' });
  });

  it('answers not-found for a missing path', async () => {
    const missing = join(project, 'nope');
    const result = await call({ path: missing });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'not-found', path: missing });
  });

  it('resolves a symlink into a project through its real path', async () => {
    const link = join(base, 'elsewhere', 'docs-link');
    symlinkSync(join(project, 'docs'), link);
    const result = await call({ path: link });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ rootId: 'project:demo', relPath: 'docs', kind: 'dir' });
  });

  it('answers no-root when resolveRoot throws, and for a non-feature folder under workspaces/', async () => {
    const thrown = await call({ path: join(project, 'docs') }, { resolveRoot: async () => { throw new Error('ROOT_NOT_FOUND'); } });
    expect(thrown.status).toBe(404);
    expect(thrown.body).toEqual({ error: 'no-root', path: join(project, 'docs'), projectKey: 'demo' });
    mkdirSync(join(project, 'workspaces', 'other'), { recursive: true });
    const other = await call({ path: join(project, 'workspaces', 'other') });
    expect(other.body).toMatchObject({ error: 'no-root', projectKey: 'demo' });
    expect(thrown.publish).not.toHaveBeenCalled();
  });

  it('prefers a scratch workspace and skips candidates whose path does not resolve', async () => {
    const scratch = join(project, 'workspaces', 'scratch-a');
    mkdirSync(scratch, { recursive: true });
    const result = await call(
      { path: scratch },
      {
        listProjects: async () => [{ key: 'demo', path: project }, { key: 'gone', path: join(base, 'missing') }],
        listScratch: async () => [{ id: 'ws-a', path: scratch }],
        resolveRoot: async () => ({ absPath: scratch, projectKey: 'demo' }),
      },
    );
    expect(result.body).toMatchObject({ rootId: 'workspace:ws-a', relPath: '', projectKey: 'demo' });
  });

  it('falls back to the project when a scratch row is refused as a root', async () => {
    const result = await call(
      { path: join(project, 'docs') },
      {
        listScratch: async () => [{ id: 'ws-primary', path: project }],
        resolveRoot: async (rootId) => {
          if (rootId.startsWith('workspace:')) throw new Error('ROOT_NOT_FOUND: workspace is the primary checkout');
          return { absPath: project, projectKey: 'demo' };
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ rootId: 'project:demo', relPath: 'docs' });
  });
});
