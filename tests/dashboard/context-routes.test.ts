import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../src/lib/projects.js';
import {
  buildContextLayerState,
  loadContextLayers,
  previewContextLayers,
  saveContextLayer,
} from '../../src/dashboard/server/routes/context.js';

let tempDir: string;
let panHome: string;
let projectRoot: string;
let workspacePath: string;
let projects: Array<{ key: string; config: ProjectConfig }>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pan-context-routes-'));
  panHome = join(tempDir, 'pan-home');
  projectRoot = join(tempDir, 'project');
  workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1201-slot-3');
  await mkdir(join(panHome, 'context'), { recursive: true });
  await mkdir(join(projectRoot, '.pan', 'context'), { recursive: true });
  await mkdir(join(workspacePath, '.pan', 'context'), { recursive: true });
  await writeFile(join(panHome, 'context', 'global.md'), 'global context', 'utf-8');
  await writeFile(join(projectRoot, '.pan', 'context', 'project.md'), 'project context', 'utf-8');
  await writeFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'workspace context', 'utf-8');
  projects = [
    {
      key: 'panopticon-cli',
      config: {
        name: 'Overdeck CLI',
        path: projectRoot,
        issue_prefix: 'PAN',
        tracker: 'github',
        workspace: { workspaces_dir: 'workspaces' },
      },
    },
  ];
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('dashboard context route helpers', () => {
  it('loads registered projects, workspaces, and canonical layer files asynchronously', async () => {
    const response = await loadContextLayers(projects, panHome);

    expect(response.operation).toBe('load');
    expect(response.projects).toEqual([
      expect.objectContaining({
        projectKey: 'panopticon-cli',
        path: projectRoot,
        workspaceRoot: join(projectRoot, 'workspaces'),
      }),
    ]);
    expect(response.workspaces).toEqual([
      expect.objectContaining({
        projectKey: 'panopticon-cli',
        path: workspacePath,
        issueId: 'PAN-1201',
      }),
    ]);
    expect(response.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'global', file: join(panHome, 'context', 'global.md'), content: 'global context' }),
      expect.objectContaining({ kind: 'project', file: join(projectRoot, '.pan', 'context', 'project.md'), content: 'project context' }),
      expect.objectContaining({ kind: 'workspace', file: join(workspacePath, '.pan', 'context', 'workspace.md'), content: 'workspace context' }),
    ]));
  });

  it('returns resolved layer state for route internals without leaking it in the public response', async () => {
    const state = await buildContextLayerState(projects, panHome);
    const response = await loadContextLayers(projects, panHome);

    expect(state.resolvedLayers).toHaveLength(3);
    expect(state.resolvedLayers[0]).toHaveProperty('dir');
    expect(response).not.toHaveProperty('resolvedLayers');
  });

  it('renders draft harness blocks without writing files', async () => {
    const response = await previewContextLayers(projects, {
      operation: 'preview',
      selectedLayer: { kind: 'workspace', projectKey: 'panopticon-cli', workspacePath },
      drafts: [
        {
          target: { kind: 'project', projectKey: 'panopticon-cli' },
          content: 'shared {{#harness:claude}}claude-only{{/harness:claude}}{{#harness:pi}}pi-only{{/harness:pi}}',
        },
      ],
    }, panHome);

    expect(response.previews['claude-code']).toContain('shared claude-only');
    expect(response.previews['claude-code']).not.toContain('pi-only');
    expect(response.previews.pi).toContain('shared pi-only');
    expect(response.previews.pi).not.toContain('claude-only');
    expect(response.previews.fullPrompt).toContain('Private harness base prompt');
    expect(response.previews.fullPrompt).toContain('Unavailable');
    expect(await readFile(join(panHome, 'context', 'global.md'), 'utf-8')).toBe('global context');
    expect(await readFile(join(projectRoot, '.pan', 'context', 'project.md'), 'utf-8')).toBe('project context');
    expect(await readFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'utf-8')).toBe('workspace context');
  });

  it('writes only the canonical selected layer file', async () => {
    const response = await saveContextLayer(projects, {
      operation: 'save',
      target: { kind: 'workspace', projectKey: 'panopticon-cli', workspacePath },
      content: 'updated workspace context',
    }, panHome);

    expect(response.layer).toEqual(expect.objectContaining({
      kind: 'workspace',
      file: join(workspacePath, '.pan', 'context', 'workspace.md'),
      content: 'updated workspace context',
    }));
    expect(await readFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'utf-8')).toBe('updated workspace context');
    expect(await readFile(join(panHome, 'context', 'global.md'), 'utf-8')).toBe('global context');
    expect(await readFile(join(projectRoot, '.pan', 'context', 'project.md'), 'utf-8')).toBe('project context');
  });

  it('rejects workspace saves outside the registered workspace allowlist', async () => {
    await expect(saveContextLayer(projects, {
      operation: 'save',
      target: {
        kind: 'workspace',
        projectKey: 'panopticon-cli',
        workspacePath: join(projectRoot, '..', 'outside-workspace'),
      },
      content: 'escape',
    }, panHome)).rejects.toThrow('Context layer is not registered');
  });
});
