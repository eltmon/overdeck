/**
 * Workspace context assembly (PAN-1201).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assembleWorkspaceContext,
  workspaceContextWithoutProjectLayer,
} from '../../../src/lib/context-layers/assemble.js';

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
      issueId: 'PAN-1201',
      workspacePath: '/ws/feature-pan-1201',
      branch: 'feat/pan-1201',
    });
    expect(out).toContain('# Workspace: PAN-1201');
    expect(out).toContain('/ws/feature-pan-1201');
    expect(out).toContain('feat/pan-1201');
  });

  it('is harness-neutral and leaves project rendering to launch composition', () => {
    const workspace = assembleWorkspaceContext({
      issueId: 'PAN-1',
      workspacePath: '/ws',
    });
    expect(workspace).toContain('# Workspace: PAN-1');
    expect(workspace).not.toContain('overdeck:project-layer');
    expect(workspaceContextWithoutProjectLayer(workspace)).toBe(workspace.trim());
  });

  it('composes the memory and status sections after the header', () => {
    const out = assembleWorkspaceContext({
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
      issueId: 'PAN-1',
      workspacePath: '/ws',
    });
    expect(out).not.toContain('## Workspace Status');
  });
});
