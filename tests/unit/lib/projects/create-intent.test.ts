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
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        cb(null, { stdout: `${dir}\n`, stderr: '' });
      } else if (cmd === 'git' && args[0] === 'remote') {
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
    expect(intent.gitRoot).toBe(realPathOf(dir));
    expect(intent.repoSlug).toBe('o/r');
    expect(intent.provider).toBe('github');
    expect(intent.defaultBranch).toBe('main');
    expect(intent.findings).toHaveLength(0);
  });

  it('flags a subdirectory of a repository and offers its root (D-15)', async () => {
    const root = makeProjectDir('repo-root');
    const nested = join(root, 'packages', 'inner');
    mkdirSync(nested, { recursive: true });

    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        cb(null, { stdout: `${root}\n`, stderr: '' });
      } else {
        cb(new Error('Unknown command'));
      }
    });

    const intent = await resolveProjectCreateIntent({
      mode: 'existing',
      path: nested,
      homeBoundary: false,
      homeDir: TEST_HOME,
    });

    // Registering here would root a second project inside an existing checkout.
    expect(intent.findings).toContainEqual(
      expect.objectContaining({
        field: 'path',
        code: 'repository-root-elsewhere',
        detail: realPathOf(root),
      }),
    );
  });

  it('detects a linked worktree, whose .git is a file not a directory (D-15)', async () => {
    const dir = makeProjectDir('worktree');
    writeFileSync(join(dir, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');

    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        cb(null, { stdout: `${dir}\n`, stderr: '' });
      } else {
        cb(new Error('no origin'));
      }
    });

    const intent = await resolveProjectCreateIntent({
      mode: 'existing',
      path: dir,
      homeBoundary: false,
      homeDir: TEST_HOME,
    });

    // The old `.git.isDirectory()` check called this a plain folder.
    expect(intent.isGitRepository).toBe(true);
  });

  it('reports an unknown default branch rather than inventing main', async () => {
    const dir = makeProjectDir('detached');

    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        cb(null, { stdout: `${dir}\n`, stderr: '' });
      } else if (cmd === 'git' && args[0] === 'rev-parse') {
        cb(null, { stdout: 'HEAD\n', stderr: '' }); // detached
      } else {
        cb(new Error('no origin/HEAD'));
      }
    });

    const intent = await resolveProjectCreateIntent({
      mode: 'existing',
      path: dir,
      homeBoundary: false,
      homeDir: TEST_HOME,
    });

    // Writing a guessed `main` would send every later workspace at a dead branch.
    expect(intent.defaultBranch).toBeNull();
  });

  it('detects non-git directory in existing mode', async () => {
    const dir = makeProjectDir('no-git');
    execFileMock.mockImplementation((cmd, args, opts, cb) => cb(new Error('not a git repository')));

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

    // Same canonical path: this is the same project, so offer to open or repair
    // it rather than arguing that the name is taken.
    expect(intent2.findings).toContainEqual(
      expect.objectContaining({ code: 'project-exists-here' }),
    );
    expect(intent2.registeredKeyAtPath).toBe('my-proj');
  });

  it('reports a key registered at a different path as a genuine conflict', async () => {
    const elsewhere = makeProjectDir('elsewhere');
    writeFileSync(
      PROJECTS_CONFIG_FILE,
      `projects:\n  taken-name:\n    name: taken-name\n    path: ${elsewhere}\n`,
    );
    invalidateProjectsConfigCache();

    const intent = await resolveProjectCreateIntent({
      mode: 'new',
      name: 'taken-name',
      homeBoundary: true,
      homeDir: TEST_HOME,
    });

    expect(intent.findings).toContainEqual(
      expect.objectContaining({ code: 'project-exists' }),
    );
    expect(intent.registeredKeyAtPath).toBeNull();
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
    // Once released, a late probe answers at once, so a coalescing regression
    // fails the callCount assertion instead of hanging until the test timeout.
    const held: Array<() => void> = [];
    let released = false;
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'git' && args[0] === 'ls-remote') {
        callCount++;
        const answer = () => cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
        if (released) answer();
        else held.push(answer);
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

    // Both resolves do real filesystem reads before the probe, so a fixed count
    // of event-loop turns raced them under CI load (nothing held yet → both
    // promises hung to the timeout). Wait until the first resolve is inside the
    // probe, then give the second real time to reach it and join the in-flight run.
    await vi.waitFor(() => expect(held.length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 250));
    released = true;
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
    // Fake only Date: the memo TTL is a clock comparison, and faking the task
    // queues as well would stall the async `realpath` calls resolve now makes.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6_000);
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

  describe('server-resolved defaults (D-4)', () => {
    it('returns homeDir and a default parentDir before the form can validate', async () => {
      // An empty clone form still has to show where files would land; a missing
      // URL is not a reason to hide the destination.
      const intent = await resolveProjectCreateIntent({
        mode: 'clone',
        url: '',
        homeBoundary: true,
        homeDir: TEST_HOME,
      });

      expect(intent.homeDir).toBe(realPathOf(TEST_HOME));
      expect(intent.parentDir).toBe(join(realPathOf(TEST_HOME), 'Projects'));
      expect(intent.findings).toContainEqual(expect.objectContaining({ code: 'url-invalid' }));
    });

    it('expands ~ and ~/sub against the server home, not the browser', async () => {
      const bare = await resolveProjectCreateIntent({
        mode: 'new',
        name: 'tilde',
        parentDir: '~',
        homeBoundary: true,
        homeDir: TEST_HOME,
      });
      expect(bare.parentDir).toBe(realPathOf(TEST_HOME));

      const nested = await resolveProjectCreateIntent({
        mode: 'new',
        name: 'tilde',
        parentDir: '~/Code',
        homeBoundary: true,
        homeDir: TEST_HOME,
      });
      expect(nested.parentDir).toBe(join(realPathOf(TEST_HOME), 'Code'));
      expect(nested.path).toBe(join(realPathOf(TEST_HOME), 'Code', 'tilde'));
    });

    it('rejects ~otheruser instead of writing into another account', async () => {
      const intent = await resolveProjectCreateIntent({
        mode: 'new',
        name: 'nope',
        parentDir: '~someoneelse/Projects',
        homeBoundary: true,
        homeDir: TEST_HOME,
      });

      expect(intent.findings).toContainEqual(
        expect.objectContaining({ field: 'parentDir', code: 'path-not-absolute' }),
      );
    });

    it('rejects a relative parent from a caller with no working directory', async () => {
      const intent = await resolveProjectCreateIntent({
        mode: 'new',
        name: 'relative',
        parentDir: 'some/where',
        homeBoundary: true,
        homeDir: TEST_HOME,
      });

      expect(intent.findings).toContainEqual(
        expect.objectContaining({ field: 'parentDir', code: 'path-not-absolute' }),
      );
    });

    it('still accepts a relative path for the CLI, which does have a cwd', async () => {
      const intent = await resolveProjectCreateIntent({
        mode: 'new',
        name: 'relative',
        parentDir: 'some/where',
        homeBoundary: false,
        homeDir: TEST_HOME,
      });

      expect(intent.findings.filter((f) => f.code === 'path-not-absolute')).toHaveLength(0);
    });
  });

  describe('path accessibility findings (D-11)', () => {
    it('says a file is a file rather than reporting it as missing', async () => {
      const filePath = join(TEST_HOME, 'a-file.txt');
      writeFileSync(filePath, 'not a directory');

      const intent = await resolveProjectCreateIntent({
        mode: 'existing',
        path: filePath,
        homeBoundary: false,
        homeDir: TEST_HOME,
      });

      expect(intent.findings).toContainEqual(
        expect.objectContaining({ field: 'path', code: 'path-not-a-directory' }),
      );
      expect(intent.findings[0].message).toMatch(/is a file/i);
    });

    it('reports a file in the middle of a path distinctly from a missing one', async () => {
      // ENOTDIR, not ENOENT: an ancestor is a regular file. "Directory not found"
      // would send the operator to create something that can never exist there.
      const blocker = join(TEST_HOME, 'blocker.txt');
      writeFileSync(blocker, 'a file, not a directory');

      const intent = await resolveProjectCreateIntent({
        mode: 'existing',
        path: join(blocker, 'inside'),
        homeBoundary: false,
        homeDir: TEST_HOME,
      });

      expect(intent.findings).toContainEqual(
        expect.objectContaining({ field: 'path', code: 'path-not-a-directory' }),
      );
      expect(intent.findings[0].message).toMatch(/is a file, so it cannot contain/i);
    });

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
