import { describe, expect, it } from 'vitest';

import type { NormalizedSemgrepConfig } from '../../config-yaml/semgrep.js';
import type { ProjectConfig } from '../../projects.js';
import { runSemgrepCiSetup, SEMGREP_SETUP_BRANCH, type SemgrepCiSetupDeps } from '../ci-setup.js';

const SEMGREP: NormalizedSemgrepConfig = {
  enabled: true,
  mcp: false,
  edit_hook: false,
  gate: 'advisory',
  severity: 'ERROR',
  configs: ['p/default'],
  timeout_seconds: 300,
};

const PROJECT: ProjectConfig = {
  name: 'Overdeck',
  path: '/repos/overdeck',
  github_repo: 'eltmon/overdeck',
  workspace: { default_branch: 'main' },
} as ProjectConfig;

const PR_URL = 'https://github.com/eltmon/overdeck/pull/9001';

interface Call { file: 'git' | 'gh'; args: string[]; cwd?: string }
type Answer = { stdout?: string; stderr?: string; fail?: boolean };

/** A short label for a recorded call: `git fetch`, `gh pr create`, `git worktree add`. */
function label(call: Call): string {
  const [first, second] = call.args;
  if (call.file === 'gh') return `gh ${first} ${second}`;
  if (first === 'remote' || first === 'worktree') return `git ${first} ${second}`;
  return `git ${first}`;
}

/** Answers for the happy path; a test overrides any label. */
const HAPPY: Record<string, Answer> = {
  'git symbolic-ref': { stdout: 'origin/main\n' },
  'git remote get-url': { stdout: 'git@github.com:eltmon/overdeck.git\n' },
  'git fetch': {},
  'git cat-file': { fail: true, stderr: 'fatal: path does not exist' },
  'gh pr list': { stdout: '[]\n' },
  'git ls-remote': { stdout: '' },
  'git worktree add': {},
  'git add': {},
  'git commit': {},
  'git push': {},
  'gh pr create': { stdout: `Creating pull request\n${PR_URL}\n` },
  'git worktree remove': {},
};

function harness(options: {
  semgrep?: Partial<NormalizedSemgrepConfig>;
  project?: ProjectConfig | null;
  answers?: Record<string, Answer>;
} = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const written: Array<{ path: string; content: string }> = [];
  const answers = { ...HAPPY, ...options.answers };
  const deps: Partial<SemgrepCiSetupDeps> = {
    loadSemgrepConfig: async () => ({ ...SEMGREP, ...options.semgrep }),
    getProject: () => (options.project === undefined ? PROJECT : options.project),
    run: async (file, args, opts) => {
      const call: Call = { file, args, ...(opts.cwd ? { cwd: opts.cwd } : {}) };
      calls.push(call);
      const answer = answers[label(call)];
      if (!answer) throw Object.assign(new Error(`unexpected call: ${file} ${args.join(' ')}`), { stderr: '' });
      if (answer.fail) throw Object.assign(new Error(`Command failed: ${file}`), { stderr: answer.stderr ?? '' });
      return { stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
    },
    writeFile: async (path, content) => { written.push({ path, content }); },
    mkdirp: async () => undefined,
    tmpRoot: () => '/home/me/.overdeck/tmp/semgrep-ci-setup',
    now: () => 1_700_000_000_000,
    log: (line) => { logs.push(line); },
  };
  const labels = () => calls.map(label);
  return { deps, calls, logs, written, labels };
}

const WORKTREE = '/home/me/.overdeck/tmp/semgrep-ci-setup/overdeck-1700000000000';

describe('runSemgrepCiSetup refusals (PAN-4592)', () => {
  const cases: Array<[string, Parameters<typeof harness>[0], string]> = [
    ['Semgrep is off', { semgrep: { enabled: false } }, 'Semgrep support is off (security.semgrep.enabled: false in ~/.overdeck/config.yaml). Turn it on first.'],
    ['the project is unknown', { project: null }, 'Unknown project "overdeck". Run: pan project list'],
    ['the project has no github_repo', { project: { ...PROJECT, github_repo: undefined } }, 'Project overdeck has no github_repo; pan semgrep ci-setup supports GitHub repositories only.'],
    ['the project is polyrepo', { project: { ...PROJECT, workspace: { default_branch: 'main', repos: [{ name: 'api', path: 'api' }] } } as ProjectConfig }, 'Project overdeck is a polyrepo project; pan semgrep ci-setup supports single-repo projects only.'],
    ['a config is auto', { semgrep: { configs: ['auto'] } }, 'security.semgrep.configs entry "auto" cannot be used in CI: --config auto needs metrics, which Overdeck turns off'],
    ['a config is absolute', { semgrep: { configs: ['/home/me/rules.yml'] } }, 'security.semgrep.configs entry "/home/me/rules.yml" is not a registry id or a repo-relative path'],
    ['a config climbs out of the repo', { semgrep: { configs: ['../rules'] } }, 'security.semgrep.configs entry "../rules" is not a registry id or a repo-relative path'],
    ['the base branch has unsafe characters', { project: { ...PROJECT, workspace: { default_branch: 'main;x' } } as ProjectConfig }, 'base branch "main;x" has characters ci-setup does not write into a workflow'],
    ['origin is a fork', { answers: { 'git remote get-url': { stdout: 'git@github.com:someone/fork.git\n' } } }, 'origin of /repos/overdeck is git@github.com:someone/fork.git, not eltmon/overdeck; ci-setup pushes to origin and opens the pull request there.'],
    ['the workflow already exists', { answers: { 'git cat-file': {} } }, 'eltmon/overdeck already has .github/workflows/semgrep.yml on main; ci-setup never overwrites it.'],
    ['a leftover setup branch has no open pull request', { answers: { 'git ls-remote': { stdout: 'abc123\trefs/heads/overdeck/semgrep-ci\n' } } }, 'Branch overdeck/semgrep-ci already exists on origin with no open pull request. Delete it or open a pull request from it.'],
  ];

  for (const [name, options, message] of cases) {
    it(`refuses when ${name}`, async () => {
      const h = harness(options);

      const result = await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps);

      expect(result).toEqual({ ok: false, message });
      expect(h.labels()).not.toContain('git push');
      expect(h.labels()).not.toContain('gh pr create');
      expect(h.labels()).not.toContain('git worktree add');
    });
  }

  it('refuses when gh pr list fails instead of treating it as no open pull request', async () => {
    const h = harness({ answers: { 'gh pr list': { fail: true, stderr: 'HTTP 401: Bad credentials\n' } } });

    const result = await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps);

    expect(result).toEqual({ ok: false, message: 'gh pr list failed: HTTP 401: Bad credentials' });
    expect(h.labels()).not.toContain('git push');
  });

  it('accepts an HTTPS origin URL in any case', async () => {
    const h = harness({ answers: { 'git remote get-url': { stdout: 'https://github.com/Eltmon/Overdeck.git\n' } } });

    expect(await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps)).toMatchObject({ ok: true });
  });
});

describe('runSemgrepCiSetup --dry-run (PAN-4592)', () => {
  it('prints the target and the workflow and runs no command', async () => {
    const h = harness();

    const result = await runSemgrepCiSetup({ projectKey: 'overdeck', dryRun: true }, h.deps);

    expect(result).toEqual({ ok: true, prUrl: null, existing: false, dryRun: true });
    expect(h.calls).toEqual([]);
    expect(h.written).toEqual([]);
    const text = h.logs.join('\n');
    expect(text).toContain('Repository: eltmon/overdeck');
    expect(text).toContain('Base branch: main');
    expect(text).toContain(`Branch: ${SEMGREP_SETUP_BRANCH}`);
    expect(text).toContain('File: .github/workflows/semgrep.yml');
    expect(text).toContain('Gate: advisory (security.semgrep.gate: advisory)');
    expect(text).toContain('image: semgrep/semgrep:1.180.0');
    expect(text).toContain('OVERDECK_SEMGREP_GATE: advisory');
  });

  it('writes the gate blocking when the project sets verification.sast: blocking', async () => {
    const h = harness({ project: { ...PROJECT, verification: { sast: 'blocking' } } });

    await runSemgrepCiSetup({ projectKey: 'overdeck', dryRun: true }, h.deps);

    expect(h.calls).toEqual([]);
    expect(h.logs.join('\n')).toContain('OVERDECK_SEMGREP_GATE: blocking');
  });

  it('uses main without reading origin/HEAD when no base branch is configured', async () => {
    const h = harness({ project: { ...PROJECT, workspace: {} } as ProjectConfig });

    await runSemgrepCiSetup({ projectKey: 'overdeck', dryRun: true }, h.deps);

    expect(h.calls).toEqual([]);
    expect(h.logs).toContain('(no base branch configured; a real run reads origin/HEAD)');
    expect(h.logs).toContain('Base branch: main');
  });
});

describe('runSemgrepCiSetup (PAN-4592)', () => {
  it('commits in a detached worktree, pushes by refspec to the setup branch and opens the pull request', async () => {
    const h = harness();

    const result = await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps);

    expect(result).toEqual({ ok: true, prUrl: PR_URL, existing: false, dryRun: false });
    expect(h.labels()).toEqual([
      'git remote get-url', 'git fetch', 'git cat-file', 'gh pr list', 'git ls-remote',
      'git worktree add', 'git add', 'git commit', 'git push', 'gh pr create', 'git worktree remove',
    ]);
    const argv = (name: string) => h.calls.find((call) => label(call) === name)!;
    expect(argv('git worktree add').args).toEqual(['worktree', 'add', '--detach', WORKTREE, 'origin/main']);
    expect(argv('git commit').args).toContain('--no-verify');
    expect(argv('git push').args).toEqual(['push', '--no-verify', 'origin', 'HEAD:refs/heads/overdeck/semgrep-ci']);
    expect(argv('git push').cwd).toBe(WORKTREE);
    expect(argv('gh pr create').args).toEqual(expect.arrayContaining(['--repo', 'eltmon/overdeck', '--base', 'main', '--head', 'overdeck/semgrep-ci']));
    expect(argv('git worktree remove').args).toEqual(['worktree', 'remove', '--force', WORKTREE]);
    for (const call of h.calls) expect(call.args.join(' ')).not.toContain('refs/heads/main');
    expect(h.written).toHaveLength(1);
    expect(h.written[0]!.path).toBe(`${WORKTREE}/.github/workflows/semgrep.yml`);
    expect(h.written[0]!.content).toContain('OVERDECK_SEMGREP_GATE: advisory');
  });

  it('reads the base branch from origin/HEAD when none is configured', async () => {
    const h = harness({
      project: { ...PROJECT, workspace: {} } as ProjectConfig,
      answers: { 'git symbolic-ref': { stdout: 'origin/develop\n' } },
    });

    await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps);

    expect(h.labels()[0]).toBe('git symbolic-ref');
    expect(h.calls.find((call) => label(call) === 'git worktree add')!.args.at(-1)).toBe('origin/develop');
  });

  it('names the workflow scope when GitHub refuses the push, and still removes the worktree', async () => {
    const h = harness({ answers: { 'git push': { fail: true, stderr: 'To github.com:eltmon/overdeck.git\n ! [remote rejected] HEAD -> overdeck/semgrep-ci (refusing to allow an OAuth App to create or update workflow `.github/workflows/semgrep.yml` without `workflow` scope)\n' } } });

    const result = await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('gh auth refresh -s workflow');
    expect(result.ok === false && result.message).toContain('pan semgrep ci-setup overdeck again');
    expect(h.labels()).not.toContain('gh pr create');
    expect(h.labels().at(-1)).toBe('git worktree remove');
  });

  it('reports the first stderr line of another push failure', async () => {
    const h = harness({ answers: { 'git push': { fail: true, stderr: '\nfatal: unable to access remote\nmore\n' } } });

    expect(await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps)).toEqual({ ok: false, message: 'git push failed: fatal: unable to access remote' });
    expect(h.labels().at(-1)).toBe('git worktree remove');
  });

  it('logs a warning and still succeeds when the worktree cannot be removed', async () => {
    const h = harness({ answers: { 'git worktree remove': { fail: true, stderr: 'fatal: busy' } } });

    expect(await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps)).toMatchObject({ ok: true, prUrl: PR_URL });
    expect(h.logs).toContain(`Warning: could not remove the worktree ${WORKTREE}: fatal: busy`);
  });

  it('returns an already open pull request without creating a worktree', async () => {
    const existing = 'https://github.com/eltmon/overdeck/pull/42';
    const h = harness({ answers: { 'gh pr list': { stdout: JSON.stringify([{ url: existing }]) } } });

    const result = await runSemgrepCiSetup({ projectKey: 'overdeck' }, h.deps);

    expect(result).toEqual({ ok: true, prUrl: existing, existing: true, dryRun: false });
    expect(h.labels()).not.toContain('git worktree add');
    expect(h.logs).toContain(`A pull request from overdeck/semgrep-ci is already open: ${existing}`);
  });

  it('adds the push trigger with --sarif-upload', async () => {
    const h = harness();

    await runSemgrepCiSetup({ projectKey: 'overdeck', sarifUpload: true }, h.deps);

    expect(h.written[0]!.content).toContain('github/codeql-action/upload-sarif@v3');
  });
});
