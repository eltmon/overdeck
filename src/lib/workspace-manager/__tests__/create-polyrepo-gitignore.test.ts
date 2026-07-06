import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePolyrepoWorkspaceGitignoreSync } from '../create.js';

describe('ensurePolyrepoWorkspaceGitignoreSync', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'polyrepo-gitignore-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('creates a new .gitignore with .pan/records/ and sub-repo entries', () => {
    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [
      { name: 'api' },
      { name: 'fe' },
      { name: 'docs' },
      { name: 'infra' },
    ]);

    expect(result.added).toEqual(['.pan/records/', 'api/', 'fe/', 'docs/', 'infra/']);
    const content = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    expect(content).toContain('.pan/records/');
    expect(content).toContain('api/');
    expect(content).toContain('fe/');
    expect(content).toContain('docs/');
    expect(content).toContain('infra/');
    expect(content).toContain('Polyrepo workspace-local state and sub-repositories');
  });

  it('appends missing entries to an existing .gitignore', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/continue.json',
      'api/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [
      { name: 'api' },
      { name: 'fe' },
      { name: 'docs' },
    ]);

    expect(result.added).toEqual(['.pan/records/', 'fe/', 'docs/']);
    const content = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    const lines = content.split('\n');
    expect(lines.filter(l => l === '.pan/records/')).toHaveLength(1);
    expect(lines.filter(l => l === 'api/')).toHaveLength(1);
    expect(lines.filter(l => l === 'fe/')).toHaveLength(1);
    expect(lines.filter(l => l === 'docs/')).toHaveLength(1);
  });

  it('does not duplicate entries already present with or without trailing slash', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/records/',
      'api',
      'fe/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [
      { name: 'api' },
      { name: 'fe' },
    ]);

    expect(result.added).toEqual([]);
  });

  it('returns empty added array when nothing changes', () => {
    writeFileSync(join(workspacePath, '.gitignore'), [
      '.pan/records/',
      'api/',
      '',
    ].join('\n'));

    const result = ensurePolyrepoWorkspaceGitignoreSync(workspacePath, [{ name: 'api' }]);

    expect(result.added).toEqual([]);
  });
});
