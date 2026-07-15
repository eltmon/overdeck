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

function writeTasks(projectPath: string, issueId: string, taskCount: number): void {
  const tasksDir = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.tasks');
  mkdirSync(tasksDir, { recursive: true });
  const lines = Array.from({ length: taskCount }, (_, index) => JSON.stringify({
    _type: 'issue',
    id: `workspace-${issueId.toLowerCase()}-${index + 1}`,
    title: `${issueId} task ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(tasksDir, 'issues.jsonl'), lines.join('\n'));
}

function writeRedirectTasks(projectPath: string, issueId: string, taskCount: number): void {
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const workspaceTasksDir = join(workspacePath, '.tasks');
  const sharedTasksDir = join(projectPath, '.tasks');
  mkdirSync(workspaceTasksDir, { recursive: true });
  mkdirSync(sharedTasksDir, { recursive: true });
  const lines = Array.from({ length: taskCount }, (_, index) => JSON.stringify({
    _type: 'issue',
    id: `shared-${issueId.toLowerCase()}-${index + 1}`,
    title: `${issueId} task ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(workspaceTasksDir, 'redirect'), '../../.tasks');
  writeFileSync(join(sharedTasksDir, 'issues.jsonl'), lines.join('\n'));
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'doctor-orphan-proposed-'));
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('orphan proposed specs doctor check', () => {
  it('reports proposed specs that have no in-flight work agent', () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-2001', 2);
    writeSpec(projectPath, 'PAN-2002', 2);
    writeTasks(projectPath, 'PAN-2002', 1);
    writeSpec(projectPath, 'PAN-2003', 2);
    writeTasks(projectPath, 'PAN-2003', 2);

    const projects = [{ key: 'overdeck', config: { name: 'Overdeck CLI', path: projectPath } }];
    expect(findOrphanProposedSpecs({ projects, tmuxSessionNames: [], agentsDir: join(testDir, 'agents') })).toEqual([
      expect.objectContaining({ issueId: 'PAN-2001', reason: 'no-agent-no-reason', planItemCount: 2 }),
      expect.objectContaining({ issueId: 'PAN-2002', reason: 'no-agent-no-reason', planItemCount: 2 }),
      expect.objectContaining({ issueId: 'PAN-2003', reason: 'no-agent-no-reason', planItemCount: 2 }),
    ]);

    const result = checkOrphanProposedSpecs({ projects, tmuxSessionNames: [], agentsDir: join(testDir, 'agents') });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('overdeck (Overdeck CLI)');
    expect(result.message).toContain('PAN-2001 no-agent-no-reason');
    expect(result.message).toContain('PAN-2002 no-agent-no-reason');
    expect(result.message).toContain('PAN-2003 no-agent-no-reason');
    expect(result.fix).toContain('pan start <id>');
  });

  it('does not consult legacy task stores', () => {
    const projectPath = join(testDir, 'project');
    mkdirSync(projectPath, { recursive: true });
    writeSpec(projectPath, 'PAN-2004', 2);
    writeRedirectTasks(projectPath, 'PAN-2004', 2);

    const projects = [{ key: 'overdeck', config: { name: 'Overdeck CLI', path: projectPath } }];
    expect(findOrphanProposedSpecs({ projects, tmuxSessionNames: [], agentsDir: join(testDir, 'agents') })).toEqual([
      expect.objectContaining({ issueId: 'PAN-2004', reason: 'no-agent-no-reason', planItemCount: 2 }),
    ]);
  });
});
