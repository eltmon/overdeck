import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildContextLayersResponse,
  previewContextLayers,
  saveContextLayer,
} from '../../../../../src/dashboard/server/routes/context.js';
import type { ProjectConfig } from '../../../../../src/lib/projects.js';

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe('dashboard context routes helpers', () => {
  let tempRoot: string;
  let oldPanopticonHome: string | undefined;

  beforeEach(async () => {
    oldPanopticonHome = process.env.PANOPTICON_HOME;
    tempRoot = await mkdtemp(join(tmpdir(), 'pan-context-route-'));
    process.env.PANOPTICON_HOME = join(tempRoot, 'home');
  });

  afterEach(async () => {
    if (oldPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = oldPanopticonHome;
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
        name: 'Panopticon',
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
    }, 'escape')).rejects.toThrow('Unknown workspace');
    await expect(exists(join(outsideWorkspace, '.pan', 'context', 'workspace.md'))).resolves.toBe(false);
  });

  it('loads registered projects, workspace candidates, and layer contents', async () => {
    const projects = await fixtureProject();
    const projectPath = projects[0]!.config.path;
    await saveContextLayer(projects, { kind: 'project', projectKey: 'pan' }, 'project content');

    const response = await buildContextLayersResponse(projects);

    expect(response.operation).toBe('load');
    expect(response.projects).toMatchObject([{ projectKey: 'pan', name: 'Panopticon', issuePrefix: 'PAN' }]);
    expect(response.workspaces).toMatchObject([{ projectKey: 'pan', name: 'feature-pan-1201', issueId: 'PAN-1201' }]);
    expect(response.layers).toContainEqual(expect.objectContaining({
      kind: 'project',
      projectKey: 'pan',
      file: join(projectPath, '.pan', 'context', 'project.md'),
      exists: true,
      content: 'project content',
    }));
  });

  it('renders preview drafts per harness without writing files', async () => {
    const projects = await fixtureProject();
    const globalFile = join(tempRoot, 'home', 'context', 'global.md');
    const content = [
      'Shared guidance.',
      '{{#harness:claude}}',
      'Claude guidance.',
      '{{/harness:claude}}',
      '{{#harness:pi}}',
      'Pi guidance.',
      '{{/harness:pi}}',
    ].join('\n');

    const response = await previewContextLayers(projects, { kind: 'global' }, [{
      target: { kind: 'global' },
      content,
    }]);

    expect(response.previews['claude-code']).toContain('Shared guidance.');
    expect(response.previews['claude-code']).toContain('Claude guidance.');
    expect(response.previews['claude-code']).not.toContain('Pi guidance.');
    expect(response.previews.pi).toContain('Shared guidance.');
    expect(response.previews.pi).toContain('Pi guidance.');
    expect(response.previews.pi).not.toContain('Claude guidance.');
    expect(response.previews.fullPrompt).toContain('Private harness base prompt: unavailable');
    await expect(exists(globalFile)).resolves.toBe(false);
  });
});
