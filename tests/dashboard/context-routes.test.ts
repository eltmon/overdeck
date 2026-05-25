import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadContextLayers,
  previewContextLayers,
  saveContextLayer,
} from '../../src/dashboard/server/routes/context.js';
import type { ProjectConfig } from '../../src/lib/projects.js';

let testRoot: string;
let previousHome: string | undefined;

function projectConfig(path: string): ProjectConfig {
  return {
    name: 'Panopticon CLI',
    path,
    issue_prefix: 'PAN',
    tracker: 'github',
    workspace: { workspaces_dir: 'workspaces' },
  };
}

beforeEach(async () => {
  testRoot = join(tmpdir(), `pan-context-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  previousHome = process.env['PANOPTICON_HOME'];
  process.env['PANOPTICON_HOME'] = join(testRoot, 'pan-home');
  await mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env['PANOPTICON_HOME'];
  else process.env['PANOPTICON_HOME'] = previousHome;
  await rm(testRoot, { recursive: true, force: true });
});

describe('dashboard context route helpers', () => {
  it('loads global, project, and workspace editable layers asynchronously', async () => {
    const projectRoot = join(testRoot, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1201');
    await mkdir(join(process.env['PANOPTICON_HOME']!, 'context'), { recursive: true });
    await mkdir(join(projectRoot, '.pan', 'context'), { recursive: true });
    await mkdir(join(workspacePath, '.pan', 'context'), { recursive: true });
    await writeFile(join(process.env['PANOPTICON_HOME']!, 'context', 'global.md'), 'global context');
    await writeFile(join(projectRoot, '.pan', 'context', 'project.md'), 'project context');
    await writeFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'workspace context');

    const response = await loadContextLayers([{ key: 'panopticon-cli', config: projectConfig(projectRoot) }]);

    expect(response.operation).toBe('load');
    expect(response.projects).toEqual([expect.objectContaining({ projectKey: 'panopticon-cli', path: projectRoot })]);
    expect(response.workspaces).toEqual([expect.objectContaining({ projectKey: 'panopticon-cli', path: workspacePath, issueId: 'PAN-1201' })]);
    expect(response.layers.map((layer) => layer.kind)).toEqual(['global', 'project', 'workspace']);
    expect(response.layers.map((layer) => layer.content)).toEqual(['global context', 'project context', 'workspace context']);
  });

  it('previews harness blocks without writing files', async () => {
    const projectRoot = join(testRoot, 'project');
    await mkdir(join(projectRoot, 'workspaces'), { recursive: true });
    await mkdir(join(projectRoot, '.pan', 'context'), { recursive: true });
    await writeFile(join(projectRoot, '.pan', 'context', 'project.md'), 'base\n{{#harness:claude}}claude only{{/harness:claude}}\n{{#harness:pi}}pi only{{/harness:pi}}');

    const response = await previewContextLayers(
      [{ key: 'panopticon-cli', config: projectConfig(projectRoot) }],
      {
        operation: 'preview',
        selectedLayer: { kind: 'project', projectKey: 'panopticon-cli' },
        drafts: [
          {
            target: { kind: 'project', projectKey: 'panopticon-cli' },
            content: 'draft\n{{#harness:claude}}claude draft{{/harness:claude}}\n{{#harness:pi}}pi draft{{/harness:pi}}',
          },
        ],
      },
    );

    expect(response.previews['claude-code']).toContain('claude draft');
    expect(response.previews['claude-code']).not.toContain('pi draft');
    expect(response.previews.pi).toContain('pi draft');
    expect(response.previews.pi).not.toContain('claude draft');
    expect(response.previews.fullPrompt).toContain('Private harness base prompt');
    expect(response.previews.fullPrompt).toContain('Unavailable');
    expect(await readFile(join(projectRoot, '.pan', 'context', 'project.md'), 'utf-8')).toContain('base');
  });

  it('saves only canonical allowlisted layer files', async () => {
    const projectRoot = join(testRoot, 'project');
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1201');
    await mkdir(workspacePath, { recursive: true });

    const projects = [{ key: 'panopticon-cli', config: projectConfig(projectRoot) }];
    const saved = await saveContextLayer(projects, {
      operation: 'save',
      target: { kind: 'workspace', projectKey: 'panopticon-cli', workspacePath },
      content: 'workspace save',
    });

    expect(saved.layer).toEqual(expect.objectContaining({ kind: 'workspace', projectKey: 'panopticon-cli', workspacePath, content: 'workspace save' }));
    expect(await readFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'utf-8')).toBe('workspace save');

    await expect(saveContextLayer(projects, {
      operation: 'save',
      target: { kind: 'workspace', projectKey: 'panopticon-cli', workspacePath: join(testRoot, 'outside') },
      content: 'escape',
    })).rejects.toThrow(/allowlist/);
  });
});
