import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectRootRef } = vi.hoisted(() => ({ projectRootRef: { current: '' } }));
vi.mock('../../../src/lib/projects.js', () => ({
  findProjectByPathSync: () => ({ name: 'Project', path: projectRootRef.current }),
}));

import {
  materializeSharedManagedLaunchContext,
  renderManagedLaunchContext,
} from '../../../src/lib/context-layers/materialize.js';
import {
  globalContextFile,
  projectContextFile,
  workspaceContextFile,
} from '../../../src/lib/context-layers/layers.js';
import { assembleWorkspaceContext } from '../../../src/lib/context-layers/assemble.js';

describe('managed launch context composition', () => {
  let overdeckHome: string;
  let previousHome: string | undefined;
  let projectRoot: string;
  let workspace: string;

  beforeEach(() => {
    overdeckHome = mkdtempSync(join(tmpdir(), 'overdeck-context-materialize-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = overdeckHome;
    projectRoot = join(overdeckHome, 'project');
    projectRootRef.current = projectRoot;
    workspace = join(projectRoot, 'workspaces', 'feature-pan-3779');

    for (const [path, content] of [
      [globalContextFile(), 'Always global.\n{{#harness:claude}}Claude global.{{/harness:claude}}\n{{#harness:codex}}Codex global.{{/harness:codex}}'],
      [projectContextFile(projectRoot), 'Always project.\n{{#harness:claude}}Claude project.{{/harness:claude}}\n{{#harness:codex}}Codex project.{{/harness:codex}}'],
      [workspaceContextFile(workspace), assembleWorkspaceContext({
        issueId: 'PAN-3779',
        workspacePath: 'private workspace',
        memoryContext: '## Memory\nHarness-neutral memory.',
      })],
    ] as const) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('renders global and project sources for the current harness exactly once', () => {
    const rendered = renderManagedLaunchContext(workspace, 'codex');
    expect(rendered).toContain('Codex global.');
    expect(rendered).toContain('Codex project.');
    expect(rendered).not.toContain('Claude global.');
    expect(rendered).not.toContain('Claude project.');
    expect(rendered.match(/Always project\./g)).toHaveLength(1);
    expect(rendered).toContain('# Workspace: PAN-3779');
    expect(rendered).toContain('Harness-neutral memory.');
  });

  it('materializes only beneath the private Overdeck context tree', () => {
    const path = materializeSharedManagedLaunchContext(workspace, 'kimi-code');
    expect(path).toMatch(new RegExp(`^${overdeckHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/context/launch/kimi-code-`));
    expect(readFileSync(path, 'utf8')).toContain('Always global.');
  });
});
