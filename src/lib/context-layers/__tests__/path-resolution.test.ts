import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  projectContextFile,
  resolveProjectContextFile,
  resolveWorkspaceContextFile,
  workspaceContextFile,
} from '../layers.js';
import {
  getReadableWorkspacePanPaths,
  getWorkspacePanPaths,
} from '../../pan-dir/continue.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'overdeck-context-paths-'));
  roots.push(value);
  return value;
}

function put(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '# context\n');
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('context layer path resolution', () => {
  it('uses the canonical .overdeck project and workspace paths', () => {
    const value = root();
    expect(projectContextFile(value)).toBe(join(value, '.overdeck', 'context', 'project.md'));
    expect(workspaceContextFile(value)).toBe(join(value, '.overdeck', 'context', 'workspace.md'));
  });

  it('falls back to legacy .pan context files', () => {
    const value = root();
    const project = join(value, '.pan', 'context', 'project.md');
    const workspace = join(value, '.pan', 'context', 'workspace.md');
    put(project);
    put(workspace);
    expect(resolveProjectContextFile(value)).toBe(project);
    expect(resolveWorkspaceContextFile(value)).toBe(workspace);
  });

  it('prefers .overdeck when both context locations exist', () => {
    const value = root();
    put(join(value, '.pan', 'context', 'project.md'));
    put(join(value, '.pan', 'context', 'workspace.md'));
    put(projectContextFile(value));
    put(workspaceContextFile(value));
    expect(resolveProjectContextFile(value)).toBe(projectContextFile(value));
    expect(resolveWorkspaceContextFile(value)).toBe(workspaceContextFile(value));
  });

  it('resolves workspace runtime reads to .overdeck with a .pan fallback', () => {
    const value = root();
    mkdirSync(join(value, '.pan'));
    expect(getReadableWorkspacePanPaths(value).panDir).toBe(join(value, '.pan'));
    mkdirSync(join(value, '.overdeck'));
    expect(getReadableWorkspacePanPaths(value)).toEqual(getWorkspacePanPaths(value));
  });
});
