/**
 * PAN-5062 WI-3: parseWorkspaceEnv, readWorkspaceEnv, loadWorkspaceEnvForProject
 * and workspaceEnvLauncherLines.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadWorkspaceEnvForProject,
  parseWorkspaceEnv,
  readWorkspaceEnv,
  workspaceEnvLauncherLines,
} from '../../../src/lib/workspace-env.js';
import type { ProjectConfig } from '../../../src/lib/workspace-config.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-5062-workspace-env-'));
  tempDirs.push(dir);
  return dir;
}

function projectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: 'proj',
    path: '/tmp/proj-does-not-matter',
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseWorkspaceEnv', () => {
  it('skips comments and blanks, unquotes values, keeps a literal URL, and drops reserved keys', () => {
    const content = [
      '# a comment',
      '',
      'export DBT_SCHEMA="dev_min_574"',
      "SINGLE='quoted'",
      'URL=http://x?a=1&b=2',
      'OVERDECK_AGENT_ID=abc123',
      'PATH=/usr/bin',
      'HOME=/home/user',
    ].join('\n');

    expect(parseWorkspaceEnv(content)).toEqual({
      DBT_SCHEMA: 'dev_min_574',
      SINGLE: 'quoted',
      URL: 'http://x?a=1&b=2',
    });
  });
});

describe('readWorkspaceEnv', () => {
  it('returns {} when .env is missing', () => {
    const dir = makeTempDir();
    expect(readWorkspaceEnv(dir)).toEqual({});
  });

  it('parses an existing .env', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'DBT_SCHEMA=dev_min_574\n');
    expect(readWorkspaceEnv(dir)).toEqual({ DBT_SCHEMA: 'dev_min_574' });
  });
});

describe('loadWorkspaceEnvForProject', () => {
  it('returns {} when the project has not opted in', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'DBT_SCHEMA=dev_min_574\n');
    expect(loadWorkspaceEnvForProject(projectConfig(), dir)).toEqual({});
  });

  it('returns {} when workspacePath equals project.path even with load: true', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'DBT_SCHEMA=dev_min_574\n');
    const project = projectConfig({ path: dir, workspace: { env: { load: true } } });
    expect(loadWorkspaceEnvForProject(project, dir)).toEqual({});
  });

  it('returns the parsed map when load is true and workspacePath differs from project.path', () => {
    const projectPath = makeTempDir();
    const workspacePath = makeTempDir();
    writeFileSync(join(workspacePath, '.env'), 'DBT_SCHEMA=dev_min_574\n');
    const project = projectConfig({ path: projectPath, workspace: { env: { load: true } } });
    expect(loadWorkspaceEnvForProject(project, workspacePath)).toEqual({ DBT_SCHEMA: 'dev_min_574' });
  });
});

describe('workspaceEnvLauncherLines', () => {
  it('returns [] and never calls findProject when workingDir has no .env', () => {
    const dir = makeTempDir();
    const findProject = vi.fn();
    expect(workspaceEnvLauncherLines(dir, findProject)).toEqual([]);
    expect(findProject).not.toHaveBeenCalled();
  });

  it('shell-quotes a value with a single quote, an ampersand and a space, and round-trips through bash', async () => {
    const workspacePath = makeTempDir();
    const tricky = "o'brien & co";
    writeFileSync(join(workspacePath, '.env'), `DBT_SCHEMA=dev_min_574\nTRICKY=${tricky}\n`);
    const project = projectConfig({ path: '/tmp/elsewhere', workspace: { env: { load: true } } });
    const findProject = vi.fn(() => project);

    const lines = workspaceEnvLauncherLines(workspacePath, findProject);

    expect(lines).toContain("export DBT_SCHEMA='dev_min_574'");
    const trickyLine = lines.find(l => l.startsWith('export TRICKY='));
    expect(trickyLine).toBeDefined();

    const { stdout } = await execFileAsync('bash', ['-c', `${trickyLine}; printf '%s' "$TRICKY"`]);
    expect(stdout).toBe(tricky);
  });
});
