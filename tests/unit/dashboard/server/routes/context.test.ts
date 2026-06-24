import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildContextLayersResponse,
  previewContextLayers,
  saveContextLayer,
  syncContextLayers,
} from '../../../../../src/dashboard/server/routes/context.js';
import type { ProjectConfig } from '../../../../../src/lib/projects.js';

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe('dashboard context routes helpers', () => {
  let tempRoot: string;
  let oldOverdeckHome: string | undefined;

  beforeEach(async () => {
    oldOverdeckHome = process.env.OVERDECK_HOME;
    tempRoot = await mkdtemp(join(tmpdir(), 'pan-context-route-'));
    process.env.OVERDECK_HOME = join(tempRoot, 'home');
  });

  afterEach(async () => {
    if (oldOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = oldOverdeckHome;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function fixtureProject(): Promise<Array<{ key: string; config: ProjectConfig }>> {
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-1201');
    await mkdir(workspacePath, { recursive: true });
    return [{
      key: 'pan',
      config: {
        name: 'Overdeck',
        path: projectPath,
        issue_prefix: 'PAN',
        workspace: { workspaces_dir: 'workspaces' },
      },
    }];
  }

  it('saves only allowlisted global, project, and workspace layer files', async () => {
    const projects = await fixtureProject();
    const projectPath = projects[0]!.config.path;
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-1201');

    await saveContextLayer(projects, { kind: 'global' }, 'global layer');
    await saveContextLayer(projects, { kind: 'project', projectKey: 'pan' }, 'project layer');
    await saveContextLayer(projects, {
      kind: 'workspace',
      projectKey: 'pan',
      workspacePath,
    }, 'workspace layer');

    await expect(readFile(join(tempRoot, 'home', 'context', 'global.md'), 'utf-8')).resolves.toBe('global layer');
    await expect(readFile(join(projectPath, '.pan', 'context', 'project.md'), 'utf-8')).resolves.toBe('project layer');
    await expect(readFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'utf-8')).resolves.toBe('workspace layer');

    const outsideWorkspace = join(tempRoot, 'outside-workspace');
    await mkdir(outsideWorkspace, { recursive: true });
    await expect(saveContextLayer(projects, {
      kind: 'workspace',
      projectKey: 'pan',
      workspacePath: outsideWorkspace,
    }, 'escape')).rejects.toThrow('Context layer is not registered');
    await expect(exists(join(outsideWorkspace, '.pan', 'context', 'workspace.md'))).resolves.toBe(false);
  });

  it('loads registered projects, workspace candidates, and layer contents', async () => {
    const projects = await fixtureProject();
    const projectPath = projects[0]!.config.path;
    await saveContextLayer(projects, { kind: 'project', projectKey: 'pan' }, 'project content');

    const response = await buildContextLayersResponse(projects);

    expect(response.operation).toBe('load');
    expect(response.projects).toMatchObject([{ projectKey: 'pan', name: 'Overdeck', issuePrefix: 'PAN' }]);
    expect(response.workspaces).toMatchObject([{ projectKey: 'pan', name: 'feature-pan-1201', issueId: 'PAN-1201' }]);
    expect(response.layers).toContainEqual(expect.objectContaining({
      kind: 'project',
      projectKey: 'pan',
      file: join(projectPath, '.pan', 'context', 'project.md'),
      exists: true,
      content: 'project content',
    }));
  });

  it('renders preview drafts per harness without writing files or syncing', async () => {
    const projects = await fixtureProject();
    const globalFile = join(tempRoot, 'home', 'context', 'global.md');
    const syncRunner = vi.fn();
    const content = [
      'Shared guidance.',
      '{{#harness:claude}}',
      'Claude guidance.',
      '{{/harness:claude}}',
      '{{#harness:ohmypi}}',
      'Ohmypi guidance.',
      '{{/harness:ohmypi}}',
    ].join('\n');

    const response = await previewContextLayers(projects, { kind: 'global' }, [{
      target: { kind: 'global' },
      content,
    }]);

    expect(response.previews['claude-code']).toContain('Shared guidance.');
    expect(response.previews['claude-code']).toContain('Claude guidance.');
    expect(response.previews['claude-code']).not.toContain('Ohmypi guidance.');
    expect(response.previews.ohmypi).toContain('Shared guidance.');
    expect(response.previews.ohmypi).toContain('Ohmypi guidance.');
    expect(response.previews.ohmypi).not.toContain('Claude guidance.');
    expect(response.previews.fullPrompt).toContain('Private harness base prompt: Unavailable');
    expect(syncRunner).not.toHaveBeenCalled();
    await expect(exists(globalFile)).resolves.toBe(false);
  });

  it('saves layer content without syncing', async () => {
    const projects = await fixtureProject();
    const syncRunner = vi.fn();

    await saveContextLayer(projects, { kind: 'global' }, 'saved');

    expect(syncRunner).not.toHaveBeenCalled();
  });

  it('runs context sync only through the explicit sync helper', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: 'synced\n', stderr: '' });

    const response = await syncContextLayers(runner);

    expect(runner).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      operation: 'sync',
      ok: true,
      status: 'synced',
      stdout: 'synced\n',
      stderr: '',
    });
  });

  it('returns structured context sync failures', async () => {
    const error = Object.assign(new Error('sync failed'), {
      code: 42,
      stdout: 'partial output',
      stderr: 'bad config',
    });
    const runner = vi.fn().mockRejectedValue(error);

    const response = await syncContextLayers(runner);

    expect(runner).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      operation: 'sync',
      ok: false,
      status: 'failed',
      stdout: 'partial output',
      stderr: 'bad config',
      error: 'sync failed',
      exitCode: 42,
    });
  });
});
