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
  /**
   * Refs the FETCH creates, as `<repoPath> <ref>` — a branch that exists only
   * on the remote until fetched. Absent means fetch changes nothing.
   */
  fetchable?: Set<string>;
  /** Repo paths whose refresh fails (transport/auth) — must fail closed. */
  failFetchIn?: Set<string>;
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
        if (args[0] === 'fetch') {
          // One forced, pruning refresh per repo:
          // `git fetch --prune origin +refs/heads/<ns>*:refs/remotes/origin/<ns>*`
          if (git.failFetchIn?.has(cwd)) return 1 as never;
          for (const key of git.fetchable ?? []) {
            if (key.startsWith(`${cwd} `)) git.refs.add(key);
          }
          return 0 as never;
        }
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
    // The LOGICAL name, never origin-qualified: assembly validates it with
    // safeBranchName(…, 'feature') and resolves origin-first itself.
    expect(queue[0]!.repoContributions.map((c) => c.branch)).toEqual([
      'feature/min-901',
      'feature/min-901',
    ]);
    expect(queue[0]!.repoContributions.map((c) => c.repoPath)).toEqual([
      `${PROJECT_ROOT}/fe`,
      `${PROJECT_ROOT}/api`,
    ]);
  });

  it('still reports the logical branch when only the local ref exists', async () => {
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/api feature/min-901`]),
      changed: new Map([[`${PROJECT_ROOT}/api feature/min-901`, ['src/b.ts']]]),
    };

    const queue = await run([{ issueId: 'MIN-901', title: 'Local only' }], reposByIssue, git);

    expect(queue[0]!.repoContributions[0]!.branch).toBe('feature/min-901');
  });

  it('diffs against the origin ref when both exist, without leaking it into the contribution', async () => {
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/api feature/min-901`,
      ]),
      changed: new Map([[`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/b.ts']]]),
    };

    const calls: string[] = [];
    const queue = await run([{ issueId: 'MIN-901', title: 'Both refs' }], reposByIssue, git, {}, calls);

    expect(queue[0]!.repoContributions[0]!.branch).toBe('feature/min-901');
    expect(calls).toContain(
      `git diff --name-only main...origin/feature/min-901 @${PROJECT_ROOT}/api`,
    );
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

describe('computePolyrepoMergeQueueFromCandidates — remote-only branches', () => {
  it('fetches a branch that exists only on the remote instead of reporting it absent', async () => {
    // `git rev-parse origin/<branch>` reads a LOCAL tracking ref, so a branch
    // pushed from another machine is invisible until fetched. Without the fetch
    // a project whose work all happens remotely never assembles anything.
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set(),
      fetchable: new Set([`${PROJECT_ROOT}/api origin/feature/min-901`]),
      changed: new Map([[`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/b.ts']]]),
    };
    const calls: string[] = [];

    const queue = await run([{ issueId: 'MIN-901', title: 'Pushed elsewhere' }], reposByIssue, git, {}, calls);

    expect(queue).toHaveLength(1);
    expect(queue[0]!.repoContributions.map((c) => c.repoKey)).toEqual(['api']);
    // Forced and pruning, so a force-pushed or deleted branch cannot leave a
    // stale tracking ref behind.
    expect(calls).toContain(
      `git fetch --prune origin +refs/heads/feature/*:refs/remotes/origin/feature/* @${PROJECT_ROOT}/api`,
    );
  });

  it('still excludes a branch that does not exist on the remote either', async () => {
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = { refs: new Set(), fetchable: new Set(), changed: new Map() };
    const excluded: Array<[string, string]> = [];

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'Nowhere' }],
      reposByIssue,
      git,
      { onExcluded: (issueId, reason) => excluded.push([issueId, reason]) },
    );

    expect(queue).toEqual([]);
    expect(excluded[0]![0]).toBe('MIN-901');
  });
});

describe('computePolyrepoMergeQueueFromCandidates — read-only repos', () => {
  it('never contributes a repo configured read-only, even when it holds the branch', async () => {
    const readOnly = { ...repo('docs', 'MIN-901', 1), required: false };
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0), readOnly]]]);
    const git: FakeGit = {
      // The branch EXISTS in the read-only repo — the policy, not absence, is
      // what must keep it out.
      refs: new Set([
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/docs origin/feature/min-901`,
      ]),
      changed: new Map([[`${PROJECT_ROOT}/api origin/feature/min-901`, ['src/b.ts']]]),
    };
    const calls: string[] = [];

    const queue = await run([{ issueId: 'MIN-901', title: 'Touches docs' }], reposByIssue, git, {}, calls);

    expect(queue[0]!.repoContributions.map((c) => c.repoKey)).toEqual(['api']);
    // Not even probed: no git command may name the read-only repo path.
    expect(calls.filter((c) => c.includes(`${PROJECT_ROOT}/docs`))).toEqual([]);
  });

  it('excludes a candidate whose only branch lives in a read-only repo', async () => {
    const readOnly = { ...repo('docs', 'MIN-901', 0), required: false };
    const reposByIssue = new Map([['MIN-901', [readOnly]]]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/docs origin/feature/min-901`]),
      changed: new Map(),
    };
    const excluded: Array<[string, string]> = [];

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'Docs only' }],
      reposByIssue,
      git,
      { onExcluded: (issueId, reason) => excluded.push([issueId, reason]) },
    );

    expect(queue).toEqual([]);
    expect(excluded[0]![1]).toContain('docs excluded as read-only');
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
    expect(excluded[0]![1]).toContain('no feature branch in any of 2 writable member repo(s)');
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
    expect(excluded).toEqual([['MIN-999', 'no writable member repos resolved for this issue']]);
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

describe('computePolyrepoMergeQueueFromCandidates — fetch failures fail closed', () => {
  it('excludes every candidate touching a repo whose refresh failed', async () => {
    // A stale tracking ref is indistinguishable from a current one, so a repo
    // we could not refresh must not contribute — otherwise assembly can test
    // and promote obsolete code.
    const reposByIssue = new Map([
      ['MIN-901', [repo('fe', 'MIN-901', 0), repo('api', 'MIN-901', 1)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/fe origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-901`,
      ]),
      failFetchIn: new Set([`${PROJECT_ROOT}/api`]),
      changed: new Map(),
    };
    const excluded: Array<[string, string]> = [];

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'Spans a broken repo' }],
      reposByIssue,
      git,
      { onExcluded: (issueId, reason) => excluded.push([issueId, reason]) },
    );

    expect(queue).toEqual([]);
    expect(excluded[0]![1]).toContain('could not refresh feature refs in api');
  });

  it('reports the unavailable repos so the caller can distinguish outage from empty', async () => {
    // An empty queue from an outage must NOT read as "no features are ready":
    // the reconciler treats that as authoritative and tears down the live batch.
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/api origin/feature/min-901`]),
      failFetchIn: new Set([`${PROJECT_ROOT}/api`]),
      changed: new Map(),
    };
    const unavailable: string[][] = [];

    await run(
      [{ issueId: 'MIN-901', title: 'One' }],
      reposByIssue,
      git,
      { onRefreshUnavailable: (paths) => unavailable.push([...paths]) },
    );

    expect(unavailable).toEqual([[`${PROJECT_ROOT}/api`]]);
  });

  it('reports nothing unavailable when every refresh succeeds', async () => {
    const reposByIssue = new Map([['MIN-901', [repo('api', 'MIN-901', 0)]]]);
    const git: FakeGit = {
      refs: new Set([`${PROJECT_ROOT}/api origin/feature/min-901`]),
      changed: new Map(),
    };
    const unavailable: string[][] = [];

    const queue = await run(
      [{ issueId: 'MIN-901', title: 'One' }],
      reposByIssue,
      git,
      { onRefreshUnavailable: (paths) => unavailable.push([...paths]) },
    );

    expect(queue).toHaveLength(1);
    expect(unavailable).toEqual([]);
  });

  it('refreshes each repo once no matter how many candidates it holds', async () => {
    const reposByIssue = new Map([
      ['MIN-901', [repo('api', 'MIN-901', 0)]],
      ['MIN-902', [repo('api', 'MIN-902', 0)]],
      ['MIN-903', [repo('api', 'MIN-903', 0)]],
    ]);
    const git: FakeGit = {
      refs: new Set([
        `${PROJECT_ROOT}/api origin/feature/min-901`,
        `${PROJECT_ROOT}/api origin/feature/min-902`,
        `${PROJECT_ROOT}/api origin/feature/min-903`,
      ]),
      changed: new Map(),
    };
    const calls: string[] = [];

    await run(
      [
        { issueId: 'MIN-901', title: 'One' },
        { issueId: 'MIN-902', title: 'Two' },
        { issueId: 'MIN-903', title: 'Three' },
      ],
      reposByIssue,
      git,
      {},
      calls,
    );

    // Three candidates in one repo used to mean three remote negotiations per
    // reconciler minute.
    expect(calls.filter((c) => c.startsWith('git fetch'))).toHaveLength(1);
  });
});
