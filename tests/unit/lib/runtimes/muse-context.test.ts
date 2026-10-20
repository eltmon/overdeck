import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectRootRef } = vi.hoisted(() => ({ projectRootRef: { current: '' } }));
vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPath: () => ({ name: 'Project', path: projectRootRef.current }),
  resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
}));

import { materializeMuseContext } from '../../../../src/lib/runtimes/muse-context.js';

describe('materializeMuseContext', () => {
  let overdeckHome: string;
  let previousHome: string | undefined;
  let projectRoot: string;
  let workspace: string;

  beforeEach(() => {
    overdeckHome = mkdtempSync(join(tmpdir(), 'overdeck-muse-context-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = overdeckHome;
    projectRoot = join(overdeckHome, 'project');
    projectRootRef.current = projectRoot;
    workspace = join(projectRoot, 'workspaces', 'feature-pan-3957');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('writes a Project memory section', async () => {
    const memoryDir = join(projectRoot, '.overdeck', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'be-decisive.md'),
      '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n',
      'utf8',
    );

    const path = await materializeMuseContext('agent-pan-3957', workspace);
    expect(path).toBe(join(overdeckHome, 'agents', 'agent-pan-3957', 'muse-context.md'));

    const rendered = readFileSync(path, 'utf8');
    expect(rendered).toContain('## Project memory');
    expect(rendered).toContain('feedback/be-decisive: Make routine reversible calls yourself.');
  });

  it('writes no memory section when the project and operator stores are empty', async () => {
    const path = await materializeMuseContext('agent-pan-3957', workspace);
    const rendered = readFileSync(path, 'utf8');
    expect(rendered).not.toContain('## Project memory');
    expect(rendered).not.toContain('## Operator memory');
  });
});
