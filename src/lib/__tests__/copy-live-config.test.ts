/**
 * Tests for copy-live-config (PAN-467)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyLiveConfigToWorkspace, injectComposeConfigMount } from '../copy-live-config.js';

let testDir: string;
let fakeHome: string;
let workspaceDir: string;

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = join(tmpdir(), `copy-live-config-test-${suffix}`);
  fakeHome = join(testDir, 'home');
  workspaceDir = join(testDir, 'workspace');

  mkdirSync(join(fakeHome, '.panopticon'), { recursive: true });
  mkdirSync(join(workspaceDir, '.git', 'info'), { recursive: true });

  // Create fake source config files
  writeFileSync(join(fakeHome, '.panopticon', 'config.yaml'), 'remote:\n  enabled: false\n');
  writeFileSync(join(fakeHome, '.panopticon', 'projects.yaml'), 'projects:\n  - name: test\n');
  writeFileSync(join(fakeHome, '.panopticon.env'), 'LINEAR_API_KEY=test-key\nGITHUB_TOKEN=ghp_test\n');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Helper: override the homedir used by CONFIG_SOURCES by writing files at the
// locations copyLiveConfigToWorkspace actually reads from (the real home).
// For unit testing we patch the SOURCE paths via the module-private array.
// Since we can't easily override homedir(), we instead test the function's
// behaviour by writing directly to the *expected* source paths and asserting
// on the result. Rather than mocking, we use a workspace-internal approach:
// call copyLiveConfigToWorkspace with a workspace path that has .git/info set up,
// verify destination files and git-exclude behaviour.
//
// The test writes real files to a temp "home" but the actual source paths come
// from os.homedir(). To avoid touching the real $HOME, we test the parts we
// can control: the destination logic, git-exclude update, and compose injection.

describe('injectComposeConfigMount', () => {
  it('injects volume mount into compose file with existing volumes block', () => {
    const composeContent = `version: '3.8'
services:
  app:
    image: node:22
    volumes:
      - ./src:/app/src
`;
    const composePath = join(workspaceDir, 'docker-compose.yml');
    writeFileSync(composePath, composeContent);

    const modified = injectComposeConfigMount(workspaceDir);

    expect(modified).toContain(composePath);
    const updated = readFileSync(composePath, 'utf-8');
    expect(updated).toContain('./.panopticon:${HOME}/.panopticon:ro');
    expect(updated).toContain('panopticon-uat-config-mount');
  });

  it('does not modify compose file that has no volumes block', () => {
    const composeContent = `version: '3.8'
services:
  app:
    image: node:22
`;
    const composePath = join(workspaceDir, 'docker-compose.yml');
    writeFileSync(composePath, composeContent);

    const modified = injectComposeConfigMount(workspaceDir);

    expect(modified).toHaveLength(0);
    const updated = readFileSync(composePath, 'utf-8');
    expect(updated).not.toContain('panopticon-uat-config-mount');
  });

  it('does not double-patch an already-patched compose file', () => {
    const composeContent = `version: '3.8'
services:
  app:
    image: node:22
    volumes:
      - ./src:/app/src
      - ./.panopticon:\${HOME}/.panopticon:ro # panopticon-uat-config-mount
`;
    const composePath = join(workspaceDir, 'docker-compose.yml');
    writeFileSync(composePath, composeContent);

    const modified = injectComposeConfigMount(workspaceDir);

    expect(modified).toHaveLength(0);
  });

  it('returns empty array when no compose files exist', () => {
    const modified = injectComposeConfigMount(workspaceDir);
    expect(modified).toHaveLength(0);
  });

  it('patches compose file inside .devcontainer/', () => {
    const devcontainerDir = join(workspaceDir, '.devcontainer');
    mkdirSync(devcontainerDir, { recursive: true });
    const composePath = join(devcontainerDir, 'docker-compose.yml');
    writeFileSync(composePath, `version: '3.8'\nservices:\n  app:\n    image: node\n    volumes:\n      - .:/workspace\n`);

    const modified = injectComposeConfigMount(workspaceDir);

    expect(modified).toContain(composePath);
    const updated = readFileSync(composePath, 'utf-8');
    expect(updated).toContain('panopticon-uat-config-mount');
  });
});

describe('copyLiveConfigToWorkspace — git exclude', () => {
  it('creates .git/info/exclude with .panopticon/ entry for regular repo', async () => {
    // Write source files at real homedir paths so copyLiveConfigToWorkspace can find them
    // We can only test the git-exclude side effect since src paths are real homedir.
    // Run with a non-existent source: skips are fine, but exclude must still be written.
    await copyLiveConfigToWorkspace(workspaceDir);

    const excludeFile = join(workspaceDir, '.git', 'info', 'exclude');
    expect(existsSync(excludeFile)).toBe(true);
    const content = readFileSync(excludeFile, 'utf-8');
    expect(content).toContain('.panopticon/');
  });

  it('does not duplicate the exclude entry on re-run', async () => {
    await copyLiveConfigToWorkspace(workspaceDir);
    await copyLiveConfigToWorkspace(workspaceDir);

    const excludeFile = join(workspaceDir, '.git', 'info', 'exclude');
    const content = readFileSync(excludeFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() === '.panopticon/');
    expect(lines).toHaveLength(1);
  });

  it('creates .panopticon/ destination directory if absent', async () => {
    // Directory should be created even if no files are copied
    await copyLiveConfigToWorkspace(workspaceDir);
    expect(existsSync(join(workspaceDir, '.panopticon'))).toBe(true);
  });
});
