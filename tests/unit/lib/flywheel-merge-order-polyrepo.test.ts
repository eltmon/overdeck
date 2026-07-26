/**
 * Tests for the polyrepo ready set (PAN-3093).
 *
 * A polyrepo candidate contributes to some subset of its project's member
 * repos; only repos that actually hold a feature branch belong in a UAT
 * generation. Git is faked at the ChildProcessSpawner boundary, so the real
 * origin-first probe and diff logic run against recorded argv — no live git.
 */

import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import {
  computePolyrepoMergeQueueFromCandidates,
  type PolyrepoMergeQueueItem,
} from '../../../src/lib/flywheel-merge-order.js';
import type { ResolvedProjectRepo } from '../../../src/lib/project-repos.js';

const PROJECT_ROOT = '/tmp/myn';

function repo(repoKey: string, issueId: string, mergeOrder: number): ResolvedProjectRepo {
  return {
    projectKey: 'mind-your-now',
    projectPath: PROJECT_ROOT,
    repoKey,
    repoPath: `${PROJECT_ROOT}/${repoKey}`,
    forge: 'github',
    sourceBranch: `feature/${issueId.toLowerCase()}`,
    targetBranch: 'main',
    mergeOrder,
    required: true,
  };
}

interface FakeGit {
  /** Refs that "exist", as `<repoPath> <ref>`. */
  refs: Set<string>;
  /** Changed files keyed `<repoPath> <ref>`. */
  changed: Map<string, string[]>;
}

/**
 * Fake spawner implementing only the two calls the queue makes:
 * `git rev-parse --verify <ref>` and `git diff --name-only <base>...<ref>`.
 * Everything else throws, so an unexpected git call fails loudly.
 */
function fakeGitLayer(git: FakeGit, calls: string[] = []): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> {
  const read = (command: ChildProcess.Command) => {
    if (command._tag !== 'StandardCommand') throw new Error('unexpected piped command');
    const cwd = command.options.cwd ?? '';
    calls.push([command.command, ...command.args].join(' ') + ` @${cwd}`);
    return { args: command.args, cwd };
  };

  const service = {
    exitCode: (command: ChildProcess.Command) =>
      Effect.sync(() => {
        const { args, cwd } = read(command);
        if (args[0] !== 'rev-parse' || args[1] !== '--verify') throw new Error(`unexpected exitCode call: ${args.join(' ')}`);
        return (git.refs.has(`${cwd} ${args[2]}`) ? 0 : 1) as never;
      }),
    string: (command: ChildProcess.Command) =>
      Effect.sync(() => {
        const { args, cwd } = read(command);
        if (args[0] !== 'diff' || args[1] !== '--name-only') throw new Error(`unexpected string call: ${args.join(' ')}`);
        const ref = String(args[2]).split('...')[1]!;
        return (git.changed.get(`${cwd} ${ref}`) ?? []).join('\n');
      }),
    spawn: () => Effect.die('spawn not supported in fake'),
    streamString: () => Effect.die('streamString not supported in fake'),
    streamLines: () => Effect.die('streamLines not supported in fake'),
    lines: () => Effect.die('lines not supported in fake'),
  } as unknown as ChildProcessSpawner.ChildProcessSpawner['Service'];

  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(service);
}

function run(
  candidates: Array<{ issueId: string; title: string; pr?: number }>,
  reposByIssue: Map<string, ResolvedProjectRepo[]>,
  git: FakeGit,
  options: Parameters<typeof computePolyrepoMergeQueueFromCandidates>[3] = {},
  calls: string[] = [],
): Promise<PolyrepoMergeQueueItem[]> {
  return Effect.runPromise(
    computePolyrepoMergeQueueFromCandidates(candidates, reposByIssue, PROJECT_ROOT, {
      // Pin hotspots so the result never depends on this machine's projects.yaml.
      hotspots: [],
      ...options,
    }).pipe(Effect.provide(fakeGitLayer(git, calls))),
  );
}

describe('computePolyrepoMergeQueueFromCandidates — contributions', () => {
  it('carries contributions only for the repos that have the feature branch', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('fe', 'MIN-901', 0), repo('api', 'MIN-901', 1), repo('infra', 'MIN-901', 2)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/fe origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        // infra has no branch at all
      ]),
      changed: new Map([
        [`${PROJECT_ROOT}/fe origin/feature/min-901`, ['src/a.ts']],
        [`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/b.ts']],
      ]),
    };

    const queue = await run([{ issueId: 'MIN-901', title: 'Spans two repos' }], reposByIssue, git);

    expect(queue).toHaveLength(1);
    expect(queue[0]!.repoContributions.map((c) => c.repoKey)).toEqual(['fe', 'api']);
    expect(queue[0]!.repoContributions.map((c) => c.branch)).toEqual([
      'origin/feature/min-901',
      'origin/feature/min-901',
    ]);
    expect(queue[0]!.repoContributions.map((c) => c.repoPath)).toEqual([
      `${PROJECT_ROOT}/fe`,
      `${PROJECT_ROOT}/api`,
    ]);
  });

  it('falls back to the local ref when origin does not have the branch', async () => {
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/api feature/min-901`]),
      changed: new Map([[`${PROJECT_ROOT}/api feature/min-901`, ['src/b.ts']]]),
    };

    const queue = await run([{ issueId: 'MIN-901', title: 'Local only' }], reposByIssue, git);

    expect(queue[0]!.repoContributions[0]!.branch).toBe('feature/min-901');
  });

  it('prefers the origin ref when both exist', async () => {
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/api feature/min-901`,
      ]),
      changed: new Map([[`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/b.ts']]]),
    };

    const queue = await run([{ issueId: 'MIN-901', title: 'Both refs' }], reposByIssue, git);

    expect(queue[0]!.repoContributions[0]!.branch).toBe('origin/feature/min-901');
  });

  it('orders contributions by the repo merge order from config', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('docs', 'MIN-901', 5), repo('api', 'MIN-901', 1), repo('fe', 'MIN-901', 0)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/docs origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/fe origin/feature/min-901`,
      ]),
      changed: new Map(),
    };

    const queue = await run([{ issueId: 'MIN-901', title: 'Three repos' }], reposByIssue, git);

    expect(queue[0]!.repoContributions.map((c) => c.repoKey)).toEqual(['fe', 'api', 'docs']);
  });

  it('diffs each contributing repo against that repo\'s own target branch', async () => {
    const custom = { ...repo('api', 'MIN-901', 0), targetBranch: 'develop' };
    const reposByIssue = new Map([['MIN-901', [custom]]]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/api origin/feature/min-901`]),
      changed: new Map([[`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/b.ts']]]),
    };
    const calls: string[] = [];

    await run([{ issueId: 'MIN-901', title: 'Custom target' }], reposByIssue, git, {}, calls);

    expect(calls).toContain(
      `git diff --name-only develop...origin/feature/min-901 @${PROJECT_ROOT}/api`,
    );
  });
});

describe('computePolyrepoMergeQueueFromCandidates — exclusions', () => {
  it('excludes a candidate with no feature branch in any repo and reports the reason', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('fe', 'MIN-901', 0), repo('api', 'MIN-901', 1)]],
    ]);
    const git: FakeGit = { refs: new Set(), changed: new Map() };
    const excluded: Array<[string, string]> = [];

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'Nothing anywhere' }],
      reposByIssue,
      git,
      { onExcluded: (issueId, reason) => excluded.push([issueId, reason]) },
    );

    expect(queue).toEqual([]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]![0]).toBe('MIN-901');
    expect(excluded[0]![1]).toContain('no feature branch in any of 2 member repo(s)');
    expect(excluded[0]![1]).toContain('fe, api');
  });

  it('excludes a candidate whose issue resolves to no member repos', async () => {
    const git: FakeGit = { refs: new Set(), changed: new Map() };
    const excluded: Array<[string, string]> = [];

    const queue = await run(
      [{ issueId: 'MIN-999', title: 'Unmapped' }],
      new Map(),
      git,
      { onExcluded: (issueId, reason) => excluded.push([issueId, reason]) },
    );

    expect(queue).toEqual([]);
    expect(excluded).toEqual([['MIN-999', 'no member repos resolved for this issue']]);
  });

  it('keeps contributing candidates when a sibling candidate is excluded', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('api', 'MIN-901', 0)]],
      ['MIN-902', [repo('api', 'MIN-902', 0)]],
    ]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/api origin/feature/min-902`]),
      changed: new Map([[`${PROJECT_ROOT}/api origin/feature/min-902`, ['src/b.ts']]]),
    };

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'Gone' }, { issueId: 'MIN-902', title: 'Present' }],
      reposByIssue,
      git,
    );

    expect(queue.map((q) => q.issueId)).toEqual(['MIN-902']);
  });
});

describe('computePolyrepoMergeQueueFromCandidates — conflict prediction', () => {
  it('records mutual conflicts when two candidates overlap within one repo', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('fe', 'MIN-901', 0), repo('api', 'MIN-901', 1)]],
      ['MIN-902', [repo('api', 'MIN-902', 1)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/fe origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-902`,
      ]),
      changed: new Map([
        [`${PROJECT_ROOT}/fe origin/feature/min-901`, ['src/only-fe.ts']],
        [`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/shared.ts']],
        [`${PROJECT_ROOT}/api origin/feature/min-902`, ['src/shared.ts']],
      ]),
    };

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'One' }, { issueId: 'MIN-902', title: 'Two' }],
      reposByIssue,
      git,
    );

    const byId = new Map(queue.map((q) => [q.issueId, q]));
    expect(byId.get('MIN-901')!.conflictsWith).toEqual(['MIN-902']);
    expect(byId.get('MIN-902')!.conflictsWith).toEqual(['MIN-901']);
    expect(byId.get('MIN-901')!.batchGroup).toBe('serialize');
    expect(byId.get('MIN-902')!.batchGroup).toBe('serialize');
  });

  it('treats the same path in different repos as disjoint', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('fe', 'MIN-901', 0)]],
      ['MIN-902', [repo('api', 'MIN-902', 1)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/fe origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-902`,
      ]),
      // Identical path, different repos — must NOT read as an overlap.
      changed: new Map([
        [`${PROJECT_ROOT}/fe origin/feature/min-901`, ['src/index.ts']],
        [`${PROJECT_ROOT}/api origin/feature/min-902`, ['src/index.ts']],
      ]),
    };

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'One' }, { issueId: 'MIN-902', title: 'Two' }],
      reposByIssue,
      git,
    );

    expect(queue.map((q) => q.conflictsWith)).toEqual([[], []]);
    expect(queue.map((q) => q.batchGroup)).toEqual(['batch', 'batch']);
    expect(queue.map((q) => q.mergeOrder)).toEqual([1, 2]);
  });

  it('applies hotspot globs to real paths before the repo prefix is added', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('api', 'MIN-901', 0)]],
      ['MIN-902', [repo('api', 'MIN-902', 0)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-902`,
      ]),
      // The only shared file is the hotspot, so filtering it leaves them disjoint.
      changed: new Map([
        [`${PROJECT_ROOT}/api origin/feature/min-901`, ['package.json', 'src/a.ts']],
        [`${PROJECT_ROOT}/api origin/feature/min-902`, ['package.json', 'src/b.ts']],
      ]),
    };

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'One' }, { issueId: 'MIN-902', title: 'Two' }],
      reposByIssue,
      git,
      { hotspots: ['package.json'] },
    );

    expect(queue.map((q) => q.conflictsWith)).toEqual([[], []]);
  });

  it('returns an empty queue for no candidates without touching git', async () => {
    const calls: string[] = [];
    const queue = await run([], new Map(), { refs: new Set(), changed: new Map() }, {}, calls);

    expect(queue).toEqual([]);
    expect(calls).toEqual([]);
  });
});
