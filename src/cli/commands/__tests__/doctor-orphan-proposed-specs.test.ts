import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { checkOrphanProposedSpecs, findOrphanProposedSpecs } from '../doctor.js';

let testDir: string;

function writeSpec(projectPath: string, issueId: string, planItemCount: number): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `${issueId}.vbrief.json`), JSON.stringify({
    vBRIEFInfo: { version: '0.5', created: '2026-05-25T00:00:00.000Z' },
    plan: {
      id: issueId,
      title: issueId,
      status: 'proposed',
      items: Array.from({ length: planItemCount }, (_, index) => ({ id: `item-${index + 1}`, title: `Item ${index + 1}` })),
      edges: [],
    },
  }, null, 2));
}

function writeBeads(projectPath: string, issueId: string, beadCount: number): void {
  const beadsDir = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  const lines = Array.from({ length: beadCount }, (_, index) => JSON.stringify({
    _type: 'issue',
    id: `workspace-${issueId.toLowerCase()}-${index + 1}`,
    title: `${issueId} bead ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(beadsDir, 'issues.jsonl'), lines.join('\n'));
}

function writeRedirectBeads(projectPath: string, issueId: string, beadCount: number): void {
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const workspaceBeadsDir = join(workspacePath, '.beads');
  const sharedBeadsDir = join(projectPath, '.beads');
  mkdirSync(workspaceBeadsDir, { recursive: true });
  mkdirSync(sharedBeadsDir, { recursive: true });
  const lines = Array.from({ length: beadCount }, (_, index) => JSON.stringify({
    _type: 'issue',
    id: `shared-${issueId.toLowerCase()}-${index + 1}`,
    title: `${issueId} bead ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(workspaceBeadsDir, 'redirect'), '../../.beads');
  writeFileSync(join(sharedBeadsDir, 'issues.jsonl'), lines.join('\n'));
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'doctor-orphan-proposed-'));
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('orphan proposed specs doctor check', () => {
  it('classifies orphan proposed specs by bead state and groups output by project', () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-2001', 2);
    writeSpec(projectPath, 'PAN-2002', 2);
    writeBeads(projectPath, 'PAN-2002', 1);
    writeSpec(projectPath, 'PAN-2003', 2);
    writeBeads(projectPath, 'PAN-2003', 2);

    const projects = [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }];
    expect(findOrphanProposedSpecs({ projects, tmuxSessionNames: [], agentsDir: join(testDir, 'agents') })).toEqual([
      expect.objectContaining({ issueId: 'PAN-2001', reason: 'beads-zero', beadCount: 0, planItemCount: 2 }),
      expect.objectContaining({ issueId: 'PAN-2002', reason: 'beads-mismatch', beadCount: 1, planItemCount: 2 }),
      expect.objectContaining({ issueId: 'PAN-2003', reason: 'no-agent-no-reason', beadCount: 2, planItemCount: 2 }),
    ]);

    const result = checkOrphanProposedSpecs({ projects, tmuxSessionNames: [], agentsDir: join(testDir, 'agents') });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('panopticon (Panopticon CLI)');
    expect(result.message).toContain('PAN-2001 beads-zero');
    expect(result.message).toContain('PAN-2002 beads-mismatch');
    expect(result.message).toContain('PAN-2003 no-agent-no-reason');
    expect(result.fix).toContain('free disk');
    expect(result.fix).toContain('spec items and bead tasks diverged');
    expect(result.fix).toContain('pan start <id>');
  });

  it('counts redirect-backed beads stores', () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-2004', 2);
    writeRedirectBeads(projectPath, 'PAN-2004', 2);

    const projects = [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }];
    expect(findOrphanProposedSpecs({ projects, tmuxSessionNames: [], agentsDir: join(testDir, 'agents') })).toEqual([
      expect.objectContaining({ issueId: 'PAN-2004', reason: 'no-agent-no-reason', beadCount: 2, planItemCount: 2 }),
    ]);
  });
});
