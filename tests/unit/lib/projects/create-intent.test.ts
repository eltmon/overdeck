/**
 * Tests for resolveProjectCreateIntent (src/lib/projects/create.ts).
 *
 * Isolation: TEST_HOME via vi.hoisted, mocked OVERDECK_HOME.
 * Mock execFile to return canned ls-remote output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const { TEST_HOME, execFileMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return {
    TEST_HOME: j(t(), `proj-create-intent-test-${process.pid}`),
    execFileMock: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: execFileMock,
  };
});

vi.mock('../../../../src/lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../../src/lib/paths.js')>('../../../../src/lib/paths.js');
  return {
    ...real,
    OVERDECK_HOME: TEST_HOME,
    CONFIG_DIR: TEST_HOME,
  };
});

vi.mock('../../../../src/lib/workspace-manager.js', () => ({
  preTrustDirectorySync: vi.fn(),
  preTrustDirectory: vi.fn(),
}));

vi.mock('../../../../src/lib/context-layers/index.js', () => ({
  ensureProjectLayer: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../../src/lib/workspaces/resolver.js', () => ({
  getMainWorkspace: vi.fn().mockReturnValue(null),
}));

import {
  resolveProjectCreateIntent,
  __resetRemoteProbeMemoForTests,
  promptGuardGitEnv,
} from '../../../../src/lib/projects/create.js';
import { getProjectSync, PROJECTS_CONFIG_FILE, invalidateProjectsConfigCache } from '../../../../src/lib/projects.js';

function realPathOf(p: string): string {
  return realpathSync(p);
}

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
    execFileMock.mockImplementation(
      (cmd, args, opts, cb) => {
        if (cmd === 'git' && args[0] === 'ls-remote') {
          cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
        } else {
          cb(new Error('Unknown command'));
        }
      }
    );

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
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        cb(new Error('Network error'));
      } else {
        cb(new Error('Unknown command'));
      }
    });

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
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });

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
    execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });

    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'remote') {
        cb(null, { stdout: 'git@github.com:o/r.git\n', stderr: '' });
      } else if (cmd === 'git' && args[0] === 'symbolic-ref') {
        cb(new Error('Not a symbolic ref'));
      } else if (cmd === 'git' && args[0] === 'rev-parse') {
        cb(null, { stdout: 'main\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });

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

    // Register the project in the projects registry by writing to the config file
    const projectsYaml = `projects:
  my-proj:
    name: my-proj
    path: ${intent1.path}
    issue_prefix: MYPROJ
`;
    writeFileSync(PROJECTS_CONFIG_FILE, projectsYaml);
    invalidateProjectsConfigCache();

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
    const outsideDir = join(tmpdir(), `proj-outside-${process.pid}`);
    mkdirSync(outsideDir, { recursive: true });

    try {
      const intent = await resolveProjectCreateIntent({
        mode: 'existing',
        path: outsideDir,
        homeBoundary: true,
        homeDir: TEST_HOME,
      });

      expect(intent.findings).toContainEqual(
        expect.objectContaining({
          code: 'path-outside-home',
        }),
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
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
    // For URL 'o/r', parseRepoUrl returns folderName='r', so key='r', and path=join(parentDir, 'r')
    const targetDir = join(parentDir, 'r');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'file.txt'), 'content');

    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });

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
    expect(intent.proposedIssuePrefix).toBe('MYNEWPROJE'); // truncated to 10
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

  it('rejects a path reached through an in-home symlink that escapes home', async () => {
    // The guard this core replaced canonicalized with realpath explicitly to reject
    // this shape. `resolve()` is lexical, so without canonicalization the link below
    // passes a prefix test while every write lands outside the boundary.
    const outside = mkdtempSync(join(tmpdir(), 'proj-outside-'));
    const link = join(TEST_HOME, 'escape');
    symlinkSync(outside, link);

    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'escaped',
      parentDir: link,
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({ field: 'parentDir', code: 'path-outside-home' }),
    );
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts an in-home symlink and reports the canonical path', async () => {
    const realParent = join(TEST_HOME, 'real-projects');
    mkdirSync(realParent, { recursive: true });
    const link = join(TEST_HOME, 'linked-projects');
    symlinkSync(realParent, link);

    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'canonical',
      parentDir: link,
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toHaveLength(0);
    expect(intent.path).toBe(join(realPathOf(realParent), 'canonical'));
  });

  it('skips the ls-remote probe for a half-typed URL', async () => {
    let callCount = 0;
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });

    const intent = await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'https://github.com/eltmon',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(callCount).toBe(0);
    expect(intent.remoteChecked).toBe(false);
  });

  it('skips the ls-remote probe when the form already has a finding', async () => {
    let callCount = 0;
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });

    // A non-empty target directory is a finding raised before detection runs.
    const target = join(TEST_HOME, 'Projects', 'taken');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'file.txt'), 'x');

    const intent = await resolveProjectCreateIntent({
      mode: 'clone',
      url: 'owner/taken',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({ code: 'target-exists' }),
    );
    expect(callCount).toBe(0);
  });

  it('coalesces concurrent probes for the same URL onto one child process', async () => {
    let callCount = 0;
    // Hold every ls-remote answer so the first resolve is still in the probe when
    // the second arrives. Firing on a timer instead would make the overlap a race.
    const held: Array<() => void> = [];
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        held.push(() => cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }));
      } else {
        cb(new Error('Unknown command'));
      }
    });

    const input = {
      mode: 'clone' as const,
      url: 'o/concurrent',
      homeBoundary: true,
      homeDir: TEST_HOME,
      refreshRemote: true,
    };
    const pA = resolveProjectCreateIntent(input);
    const pB = resolveProjectCreateIntent(input);

    // Drain enough event-loop turns for the second resolve to finish its own
    // filesystem reads and reach the probe; the first cannot advance past it.
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setImmediate(r));
    }
    for (const fire of held) fire();

    const [a, b] = await Promise.all([pA, pB]);

    expect(callCount).toBe(1);
    expect(a.defaultBranch).toBe('main');
    expect(b.defaultBranch).toBe('main');
  });

  it('expires a failed probe faster than a successful one', async () => {
    let callCount = 0;
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        cb(new Error('Network error'));
      } else {
        cb(new Error('Unknown command'));
      }
    });

    const input = {
      mode: 'clone' as const,
      url: 'o/flaky',
      homeBoundary: true,
      homeDir: TEST_HOME,
    };

    await resolveProjectCreateIntent(input);
    expect(callCount).toBe(1);

    // Within the 5 s failure TTL the memo still answers.
    await resolveProjectCreateIntent(input);
    expect(callCount).toBe(1);

    // Past it, the URL is probed again instead of staying pinned as unreachable.
    // Fake timers so the TTL is crossed by advancing the clock, never by sleeping.
    vi.useFakeTimers();
    vi.advanceTimersByTime(6_000);
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });
    const recovered = await resolveProjectCreateIntent(input);
    expect(callCount).toBe(2);
    expect(recovered.defaultBranch).toBe('main');
    vi.useRealTimers();
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
