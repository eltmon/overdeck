/**
 * Workspace context assembly (PAN-1201).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { assembleWorkspaceContext } from '../../../src/lib/context-layers/assemble.js';
import { projectContextFile } from '../../../src/lib/context-layers/layers.js';

describe('assembleWorkspaceContext', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-assemble-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('includes the issue header, branch and workspace path', () => {
    const out = assembleWorkspaceContext({
      projectRoot,
      harness: 'claude-code',
      issueId: 'PAN-1201',
      workspacePath: '/ws/feature-pan-1201',
      branch: 'feat/pan-1201',
    });
    expect(out).toContain('# Workspace: PAN-1201');
    expect(out).toContain('/ws/feature-pan-1201');
    expect(out).toContain('feat/pan-1201');
  });

  it('folds in the project layer rendered for the target harness', () => {
    const pf = projectContextFile(projectRoot);
    mkdirSync(dirname(pf), { recursive: true });
    writeFileSync(pf, 'Project rule.\n{{#harness:pi}}pi-only{{/harness:pi}}');

    const claude = assembleWorkspaceContext({
      projectRoot,
      harness: 'claude-code',
      issueId: 'PAN-1',
      workspacePath: '/ws',
    });
    expect(claude).toContain('Project rule.');
    expect(claude).not.toContain('pi-only');
  });

  it('composes the memory and status sections after the header', () => {
    const out = assembleWorkspaceContext({
      projectRoot,
      harness: 'claude-code',
      issueId: 'PAN-1',
      workspacePath: '/ws',
      memoryContext: '## Memory\nremembered fact',
      statusSummary: 'all green',
    });
    expect(out.indexOf('remembered fact')).toBeGreaterThan(out.indexOf('# Workspace'));
    expect(out.indexOf('all green')).toBeGreaterThan(out.indexOf('remembered fact'));
  });

  it('omits sections with no content', () => {
    const out = assembleWorkspaceContext({
      projectRoot,
      harness: 'claude-code',
      issueId: 'PAN-1',
      workspacePath: '/ws',
    });
    expect(out).not.toContain('## Workspace Status');
  });
});
