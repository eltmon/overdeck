import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectRootRef } = vi.hoisted(() => ({ projectRootRef: { current: '' } }));
vi.mock('../../../src/lib/projects.js', () => ({
  findProjectByPath: () => ({ name: 'Project', path: projectRootRef.current }),
  resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
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
import { materializeAcpContextFile } from '../../../src/lib/acp/context.js';
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
    expect(rendered).toContain(`Source: ${globalContextFile()}`);
    expect(rendered).toContain(`Source: ${projectContextFile(projectRoot)}`);
    expect(rendered).toContain(`Source: ${workspaceContextFile(workspace)}`);
    expect(rendered).toContain('# Overdeck managed instructions');
  });

  it('preserves OpenCode filtering through its ACP context transport', () => {
    writeFileSync(projectContextFile(projectRoot), '{{#harness:opencode}}OpenCode project.{{/harness:opencode}}\n{{#harness:acp}}ACP project.{{/harness:acp}}');
    const path = materializeAcpContextFile(join(overdeckHome, 'agents', 'test'), workspace, 'opencode');
    const rendered = readFileSync(path, 'utf8');
    expect(rendered).toContain('OpenCode project.');
    expect(rendered).not.toContain('ACP project.');
    expect(rendered).toContain(`Source: ${projectContextFile(projectRoot)}`);
  });

  it('materializes only beneath the private Overdeck context tree', () => {
    const path = materializeSharedManagedLaunchContext(workspace, 'kimi-code');
    expect(path).toMatch(new RegExp(`^${overdeckHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/context/launch/kimi-code-`));
    expect(readFileSync(path, 'utf8')).toContain('Always global.');
  });

  describe('curated memory sections (PAN-3957)', () => {
    function writeProjectFact(id: string, body: string) {
      const dir = join(projectRoot, '.overdeck', 'memory');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.md`), body, 'utf8');
    }

    function writeOperatorFact(id: string, body: string) {
      const dir = join(overdeckHome, 'context', 'memory');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.md`), body, 'utf8');
    }

    it('includes Project memory between the project layer and the workspace section', () => {
      writeProjectFact('be-decisive', '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n');
      const rendered = renderManagedLaunchContext(workspace, 'codex');
      expect(rendered.indexOf('## Project context')).toBeLessThan(rendered.indexOf('## Project memory'));
      expect(rendered.indexOf('## Project memory')).toBeLessThan(rendered.indexOf('## Workspace context'));
      expect(rendered).toContain('feedback/be-decisive: Make routine reversible calls yourself.');
    });

    it('includes Operator memory from OVERDECK_HOME/context/memory', () => {
      writeOperatorFact('terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');
      const rendered = renderManagedLaunchContext(workspace, 'codex');
      expect(rendered).toContain('## Operator memory');
      expect(rendered).toContain('user/terse-answers: Keep answers terse.');
    });

    it('the codex and claude renders carry the identical memory section', () => {
      writeProjectFact('be-decisive', '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n');
      writeOperatorFact('terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');
      const codexRendered = renderManagedLaunchContext(workspace, 'codex');
      const claudeRendered = renderManagedLaunchContext(workspace, 'claude-code');
      const extractMemory = (text: string) => text.slice(text.indexOf('## Project memory'), text.indexOf('## Workspace context'));
      expect(extractMemory(codexRendered)).toBe(extractMemory(claudeRendered));
    });

    it('a review-marked fact is absent', () => {
      writeProjectFact('marked-fact', '---\ntype: feedback\ndescription: Should not appear.\nreview: [unindexed]\n---\nBody.\n');
      const rendered = renderManagedLaunchContext(workspace, 'codex');
      expect(rendered).not.toContain('## Project memory');
      expect(rendered).not.toContain('Should not appear.');
    });

    it('renders neither heading when both stores are empty', () => {
      const rendered = renderManagedLaunchContext(workspace, 'codex');
      expect(rendered).not.toContain('## Project memory');
      expect(rendered).not.toContain('## Operator memory');
    });
  });
});
