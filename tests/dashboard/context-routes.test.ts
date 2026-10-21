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
      key: 'overdeck',
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
        projectKey: 'overdeck',
        path: projectRoot,
        workspaceRoot: join(projectRoot, 'workspaces'),
      }),
    ]);
    expect(response.workspaces).toEqual([
      expect.objectContaining({
        projectKey: 'overdeck',
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
      selectedLayer: { kind: 'workspace', projectKey: 'overdeck', workspacePath },
      drafts: [
        {
          target: { kind: 'project', projectKey: 'overdeck' },
          content: 'shared {{#harness:claude}}claude-only{{/harness:claude}}{{#harness:ohmypi}}ohmypi-only{{/harness:ohmypi}}',
        },
      ],
    }, panHome);

    expect(response.previews['claude-code']).toContain('shared claude-only');
    expect(response.previews['claude-code']).not.toContain('ohmypi-only');
    expect(response.previews.ohmypi).toContain('shared ohmypi-only');
    expect(response.previews.ohmypi).not.toContain('claude-only');
    expect(response.previews.fullPrompt).toContain('Private harness base prompt');
    expect(response.previews.fullPrompt).toContain('Unavailable');
    expect(await readFile(join(panHome, 'context', 'global.md'), 'utf-8')).toBe('global context');
    expect(await readFile(join(projectRoot, '.pan', 'context', 'project.md'), 'utf-8')).toBe('project context');
    expect(await readFile(join(workspacePath, '.pan', 'context', 'workspace.md'), 'utf-8')).toBe('workspace context');
  });

  it('writes only the canonical selected layer file', async () => {
    const response = await saveContextLayer(projects, {
      operation: 'save',
      target: { kind: 'workspace', projectKey: 'overdeck', workspacePath },
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
        projectKey: 'overdeck',
        workspacePath: join(projectRoot, '..', 'outside-workspace'),
      },
      content: 'escape',
    }, panHome)).rejects.toThrow('Context layer is not registered');
  });

  describe('curated memory sections in the preview (PAN-3957)', () => {
    it('project-scoped preview contains ## Project memory for a project with facts', async () => {
      await mkdir(join(projectRoot, '.overdeck', 'memory'), { recursive: true });
      await writeFile(
        join(projectRoot, '.overdeck', 'memory', 'be-decisive.md'),
        '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n',
        'utf-8',
      );

      const response = await previewContextLayers(projects, {
        operation: 'preview',
        selectedLayer: { kind: 'workspace', projectKey: 'overdeck', workspacePath },
        drafts: [],
      }, panHome);

      expect(response.previews['claude-code']).toContain('## Project memory');
      expect(response.previews['claude-code']).toContain('feedback/be-decisive: Make routine reversible calls yourself.');
      expect(response.previews.codex).toContain('## Project memory');
    });

    it('global-only preview contains ## Operator memory and no Project memory', async () => {
      await mkdir(join(panHome, 'context', 'memory'), { recursive: true });
      await writeFile(
        join(panHome, 'context', 'memory', 'terse-answers.md'),
        '---\ntype: feedback\ndescription: Keep answers terse.\n---\nBody.\n',
        'utf-8',
      );

      const response = await previewContextLayers(projects, {
        operation: 'preview',
        selectedLayer: { kind: 'global' },
        drafts: [],
      }, panHome);

      expect(response.previews['claude-code']).toContain('## Operator memory');
      expect(response.previews['claude-code']).toContain('feedback/terse-answers: Keep answers terse.');
      expect(response.previews['claude-code']).not.toContain('## Project memory');
    });

    it('global-only preview contains ## Machine memory for a fact in context/machine-memory (PAN-4578)', async () => {
      await mkdir(join(panHome, 'context', 'machine-memory'), { recursive: true });
      await writeFile(
        join(panHome, 'context', 'machine-memory', 'gpu.md'),
        '---\ntype: reference\ndescription: The GPU is an RTX 3090.\n---\nBody.\n',
        'utf-8',
      );

      const response = await previewContextLayers(projects, {
        operation: 'preview',
        selectedLayer: { kind: 'global' },
        drafts: [],
      }, panHome);

      expect(response.previews['claude-code']).toContain('## Machine memory');
      expect(response.previews['claude-code']).toContain('reference/gpu: The GPU is an RTX 3090.');
    });

    it('no memory heading when the injected project has no store and panHome has no context/memory', async () => {
      const response = await previewContextLayers(projects, {
        operation: 'preview',
        selectedLayer: { kind: 'workspace', projectKey: 'overdeck', workspacePath },
        drafts: [],
      }, panHome);

      expect(response.previews['claude-code']).not.toContain('## Project memory');
      expect(response.previews['claude-code']).not.toContain('## Operator memory');
    });
  });
});
