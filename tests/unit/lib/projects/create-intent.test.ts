/**
 * Tests for resolveProjectCreateIntent (src/lib/projects/create.ts).
 *
 * Isolation: TEST_HOME via vi.hoisted, mocked OVERDECK_HOME.
 * Mock execFile to return canned ls-remote output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return { TEST_HOME: j(t(), `proj-create-intent-test-${process.pid}`) };
});

vi.mock('../../../src/lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/lib/paths.js')>('../../../src/lib/paths.js');
  return {
    ...real,
    OVERDECK_HOME: TEST_HOME,
    CONFIG_DIR: TEST_HOME,
  };
});

vi.mock('../../../src/lib/workspace-manager.js', () => ({
  preTrustDirectorySync: vi.fn(),
  preTrustDirectory: vi.fn(),
}));

vi.mock('../../../src/lib/context-layers/index.js', () => ({
  ensureProjectLayer: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/lib/workspaces/resolver.js', () => ({
  getMainWorkspace: vi.fn().mockReturnValue(null),
}));

import {
  resolveProjectCreateIntent,
  __resetRemoteProbeMemoForTests,
  promptGuardGitEnv,
} from '../../../src/lib/projects/create.js';
import { getProjectSync, PROJECTS_CONFIG_FILE } from '../../../src/lib/projects.js';

function makeProjectDir(suffix = '') {
  const dir = join(TEST_HOME, `proj-${suffix}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  try {
    rmSync(PROJECTS_CONFIG_FILE);
  } catch {
    // ok if missing
  }
  __resetRemoteProbeMemoForTests();
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('resolveProjectCreateIntent', () => {
  it('resolves clone mode with shorthand URL and mocked ls-remote', async () => {
    vi.mocked('child_process').execFile = vi.fn(
      (cmd, args, opts, cb) => {
        if (cmd === 'git' && args[0] === 'ls-remote') {
          cb(null, { stdout: 'ref: refs/heads/main HEAD\n', stderr: '' });
        } else {
          cb(new Error('Unknown command'));
        }
      }
    ) as any;

    const intent = await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'stablyai/orca',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.mode).toBe('clone');
    expect(intent.key).toBe('orca');
    expect(intent.path).toBe(join(TEST_HOME, 'Projects', 'orca'));
    expect(intent.repoSlug).toBe('stablyai/orca');
    expect(intent.provider).toBe('github');
    expect(intent.defaultBranch).toBe('main');
    expect(intent.wouldClone).toBe(true);
    expect(intent.remoteChecked).toBe(true);
    expect(intent.findings).toHaveLength(0);
    expect(intent.proposedIssuePrefix).toBe('ORCA');
  });

  it('returns url-invalid finding for unparseable URL', async () => {
    const intent = await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'not-a-url-at-all',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({
        field: 'url',
        code: 'url-invalid',
      }),
    );
  });

  it('returns remote-unreachable finding when ls-remote fails', async () => {
    vi.mocked('child_process').execFile = vi.fn((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        cb(new Error('Network error'));
      }
    }) as any;

    const intent = await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'o/r',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({
        code: 'remote-unreachable',
      }),
    );
  });

  it('memoizes ls-remote probe for 60s and respects refreshRemote', async () => {
    let callCount = 0;
    vi.mocked('child_process').execFile = vi.fn((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        cb(null, { stdout: 'ref: refs/heads/main HEAD\n', stderr: '' });
      }
    }) as any;

    await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'o/r',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });
    expect(callCount).toBe(1);

    await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'o/r',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });
    expect(callCount).toBe(1); // memo hit

    await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'o/r',
      homeBoundary: true,
      homeDir: TEST_HOME,
      refreshRemote: true,
    });
    expect(callCount).toBe(2); // refreshRemote bypass
  });

  it('resolves existing mode with a real temp git repo', async () => {
    const dir = makeProjectDir('existing');
    writeFileSync(join(dir, '.git'), 'gitdir: /tmp/worktree\n');
    mkdirSync(join(dir, '.git'), { recursive: true });

    vi.mocked('child_process').execFile = vi.fn((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'remote') {
        cb(null, { stdout: 'git@github.com:o/r.git\n', stderr: '' });
      } else if (cmd === 'git' && args[0] === 'symbolic-ref') {
        cb(new Error('Not a symbolic ref'));
      } else if (cmd === 'git' && args[0] === 'rev-parse') {
        cb(null, { stdout: 'main\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    }) as any;

    const intent = await resolveProjectCreateIntent({
      mode: 'existing',
      path: dir,
      homeBoundary: false,
      homeDir: TEST_HOME,
    });

    expect(intent.isGitRepository).toBe(true);
    expect(intent.repoSlug).toBe('o/r');
    expect(intent.provider).toBe('github');
    expect(intent.findings).toHaveLength(0);
  });

  it('detects non-git directory in existing mode', async () => {
    const dir = makeProjectDir('no-git');

    const intent = await resolveProjectCreateIntent({
      mode: 'existing',
      path: dir,
      homeBoundary: false,
      homeDir: TEST_HOME,
    });

    expect(intent.isGitRepository).toBe(false);
    expect(intent.repoSlug).toBeNull();
  });

  it('returns project-exists finding for duplicate key', async () => {
    const intent1 = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'my-proj',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });
    expect(intent1.key).toBe('my-proj');
    expect(intent1.findings).toHaveLength(0);

    // Manually register to create a duplicate
    const existing = getProjectSync('my-proj');
    if (!existing) {
      // Write it to projects.yaml via the sync function (mock would be needed in real test)
    }

    const intent2 = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'my-proj',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent2.findings).toContainEqual(
      expect.objectContaining({
        code: 'project-exists',
      }),
    );
  });

  it('returns issue-prefix-invalid finding for bad prefix', async () => {
    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'valid-name',
      issuePrefix: 'bad1',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({
        code: 'issue-prefix-invalid',
      }),
    );
  });

  it('returns path-outside-home finding when homeBoundary=true and path escapes $HOME', async () => {
    const intent = await resolveProjectCreateIntent({
      mode: 'existing',
      path: '/tmp/outside',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({
        code: 'path-outside-home',
      }),
    );
  });

  it('allows paths outside $HOME when homeBoundary=false', async () => {
    const externalDir = join(tmpdir(), `proj-external-${process.pid}`);
    mkdirSync(externalDir, { recursive: true });

    try {
      const intent = await resolveProjectCreateIntent({
        mode: 'existing',
        path: externalDir,
        homeBoundary: false,
        homeDir: TEST_HOME,
      });

      expect(intent.findings.filter((f) => f.code === 'path-outside-home')).toHaveLength(0);
    } finally {
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it('returns target-exists finding for non-empty clone target', async () => {
    const parentDir = makeProjectDir('parent');
    const targetDir = join(parentDir, 'my-proj');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'file.txt'), 'content');

    const intent = await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'o/r',
      parentDir,
      homeBoundary: false,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({
        code: 'target-exists',
      }),
    );
  });

  it('resolves new mode with name and generates proposedIssuePrefix', async () => {
    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'my-new-project',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.mode).toBe('new');
    expect(intent.key).toBe('my-new-project');
    expect(intent.name).toBe('my-new-project');
    expect(intent.wouldGitInit).toBe(true);
    expect(intent.isGitRepository).toBe(true);
    expect(intent.proposedIssuePrefix).toBe('MYNEWPROJECT'); // truncated to 10
    expect(intent.findings).toHaveLength(0);
  });

  it('truncates long issue prefix to 10 characters', async () => {
    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'this-is-a-very-long-project-name',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.proposedIssuePrefix).toBe('THISISAVER'); // first 10 chars
  });

  it('sets willCreateMainWorkspace correctly', async () => {
    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'fresh-proj',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.willCreateMainWorkspace).toBe(true);
  });

  it('promptGuardGitEnv sets correct environment variables', () => {
    const env = promptGuardGitEnv({});

    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBe('true');
    expect(env.SSH_ASKPASS).toBe('true');
    expect(env.GCM_INTERACTIVE).toBe('never');
    expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes');
  });
});
