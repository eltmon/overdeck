import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePolyrepoWorkspaceGitignoreSync, commitPolyrepoWorkspaceGitignoreAsync } from '../create.js';

const mockExec = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: mockExec,
  };
});

describe('ensurePolyrepoWorkspaceGitignoreSync', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'polyrepo-gitignore-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('creates a new .gitignore with sub-repo entries and no durable record ignore', () => {
    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [
      { name: 'api' },
      { name: 'fe' },
      { name: 'docs' },
      { name: 'infra' },
    ]);

    expect(result.added).toEqual(['api/', 'fe/', 'docs/', 'infra/', '.overdeck/']);
    expect(result.removed).toEqual([]);
    const content = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.pan/records/');
    expect(content).toContain('api/');
    expect(content).toContain('fe/');
    expect(content).toContain('docs/');
    expect(content).toContain('infra/');
    expect(content).toContain('Polyrepo sub-repositories');
    expect(content).toContain('.overdeck/');
  });

  it('appends the .overdeck/ runtime entry when missing', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      'api/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [{ name: 'api' }]);

    expect(result.added).toEqual(['.overdeck/']);
    const lines = readFileSync(join(workspacePath, '.gitignore'), 'utf-8').split('\n');
    expect(lines.filter(l => l === '.overdeck/')).toHaveLength(1);
    expect(lines.some(l => l.includes('Overdeck workspace runtime'))).toBe(true);
  });

  it('does not duplicate an existing .overdeck entry with or without trailing slash', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      'api/',
      '.overdeck',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [{ name: 'api' }]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('appends missing entries to an existing .gitignore', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/continue.json',
      '.overdeck/',
      'api/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [
      { name: 'api' },
      { name: 'fe' },
      { name: 'docs' },
    ]);

    expect(result.added).toEqual(['fe/', 'docs/']);
    expect(result.removed).toEqual([]);
    const content = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    const lines = content.split('\n');
    expect(lines.filter(l => l === '.pan/records/')).toHaveLength(0);
    expect(lines.filter(l => l === 'api/')).toHaveLength(1);
    expect(lines.filter(l => l === 'fe/')).toHaveLength(1);
    expect(lines.filter(l => l === 'docs/')).toHaveLength(1);
  });

  it('does not duplicate entries already present with or without trailing slash', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      'api',
      'fe/',
      '.overdeck/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [
      { name: 'api' },
      { name: 'fe' },
    ]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('returns empty added array when nothing changes', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      'api/',
      '.overdeck/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [{ name: 'api' }]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('removes stale .pan/records ignores so durable records stay trackable', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/records/',
      'api/',
      '.pan/records',
      '.overdeck/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [{ name: 'api' }]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(['.pan/records/', '.pan/records']);
    const content = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.pan/records');
    expect(content).toContain('api/');
  });
});

describe('commitPolyrepoWorkspaceGitignoreAsync', () => {
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'polyrepo-gitignore-commit-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('stages and commits .gitignore when workspace is a git repo', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    writeFileSync(join(workspacePath, '.gitignore'), 'api/\n');

    mockExec.mockImplementation((cmd: string, _opts: any, callback: any) => {
      if (cmd.includes('git diff --cached --quiet')) {
        callback?.(new Error('has changes'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const message = await commitPolyrepoWorkspaceGitignoreAsync(workspacePath);

    expect(message).toBe('Committed polyrepo workspace .gitignore');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls).toContain('git add .gitignore');
    expect(calls).toContain('git diff --cached --quiet');
    expect(calls).toContain('git commit -m "chore(workspace): add polyrepo scaffold .gitignore"');
  });

  it('returns null when there is nothing to commit', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    writeFileSync(join(workspacePath, '.gitignore'), 'api/\n');

    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      callback?.(null, '', '');
    });

    const message = await commitPolyrepoWorkspaceGitignoreAsync(workspacePath);

    expect(message).toBeNull();
  });

  it('returns null when workspace is not a git repo', async () => {
    writeFileSync(join(workspacePath, '.gitignore'), 'api/\n');

    const message = await commitPolyrepoWorkspaceGitignoreAsync(workspacePath);

    expect(message).toBeNull();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns a warning message when git commit fails', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    writeFileSync(join(workspacePath, '.gitignore'), 'api/\n');

    mockExec.mockImplementation((cmd: string, _opts: any, callback: any) => {
      if (cmd.includes('git commit')) {
        callback?.(new Error('commit failed'), '', '');
      } else if (cmd.includes('git diff --cached --quiet')) {
        callback?.(new Error('has changes'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const message = await commitPolyrepoWorkspaceGitignoreAsync(workspacePath);

    expect(message).toContain('Warning: could not commit workspace .gitignore');
  });
});
