/**
 * PAN-1728 — the plan-integrity gate resolves the reference spec from git and
 * fails a branch that changes the spec beyond its lifecycle status fields.
 * Real temp git repos with a bare `origin`; global git config isolated.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/pan-dir/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/pan-dir/paths.js')>()),
  resolvePlanHome: (path: string) => path,
}));

import { evaluatePlanIntegrityGate, resolvePlanReference } from '../../../../src/lib/cloister/plan-integrity-run.js';
import { formatPlanFinalizedTrailer, planFinalizedHash } from '../../../../src/lib/xbrief/plan-finalized.js';

const ISSUE = 'PAN-1';
const SPEC = '.pan/specs/2026-09-29-PAN-1-test-plan.xbrief.json';

let root: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(rel: string, content: string): void {
  const path = join(repo, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function spec(mutate: (doc: Record<string, any>) => void = () => {}): string {
  const doc: Record<string, any> = {
    xBRIEFInfo: { version: '0.8', created: '2026-09-29T00:00:00Z', updated: '2026-09-29T00:00:00Z' },
    status: 'proposed',
    plan: {
      id: 'pan-1',
      title: 'Plan',
      status: 'proposed',
      sequence: 1,
      updated: '2026-09-29T00:00:00Z',
      narratives: { Problem: 'the problem' },
      items: [
        { id: 'x', title: 'Item x', status: 'pending', items: [{ id: 'x.ac1', title: 'Given X, then Y', status: 'pending' }] },
        { id: 'y', title: 'Item y', status: 'pending' },
      ],
    },
  };
  mutate(doc);
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Stage everything and commit; returns the new HEAD sha. */
function commit(subject: string, trailer?: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', subject, ...(trailer ? ['-m', trailer] : []));
  return git(repo, 'rev-parse', 'HEAD').trim();
}

function commitSpec(content: string, subject: string, trailer: 'valid' | 'wrong' | 'none' = 'none'): string {
  write(SPEC, content);
  const value = trailer === 'valid' ? planFinalizedHash(content) : planFinalizedHash('something else');
  return commit(subject, trailer === 'none' ? undefined : formatPlanFinalizedTrailer(value));
}

function branchOff(): void {
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'switch', '-q', '-c', 'feature/pan-1');
}

const roots = () => [{ repoKey: 'repo', dir: repo, targetBranch: 'main' }];
const run = () => evaluatePlanIntegrityGate(ISSUE, repo, roots());

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plan-integrity-')));
  repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(root, 'empty-gitconfig'), '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'empty-gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  git(root, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@overdeck.local');
  git(repo, 'config', 'user.name', 'Overdeck Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'remote', 'add', 'origin', join(root, 'origin.git'));
  write('README.md', 'hello\n');
  commit('init');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('evaluatePlanIntegrityGate (PAN-1728)', () => {
  it('fails an AC status edit after the trailer commit and names the AC and the remediation', async () => {
    branchOff();
    const finalize = commitSpec(spec(), 'chore(plan): finalize', 'valid');
    commitSpec(spec((doc) => { doc.plan.items[0].items[0].status = 'completed'; }), 'chore: mark acceptance criteria complete');

    const result = await run();

    expect(result.failed).toBe(true);
    expect(result.evidence.split('\n')[0]).toBe(`reference: trailer ${finalize.slice(0, 8)}`);
    expect(result.evidence).toContain('item x.ac1: changed status');
    expect(result.evidence).toContain(`git restore --source=${finalize} --staged --worktree -- ${SPEC}`);
    expect(result.evidence).toContain('pan plan PAN-1');
  });

  it('passes a later commit that changes only the five allowed fields', async () => {
    branchOff();
    commitSpec(spec(), 'chore(plan): finalize', 'valid');
    commitSpec(spec((doc) => {
      doc.status = 'active';
      doc.plan.status = 'running';
      doc.plan.sequence = 4;
      doc.plan.updated = '2026-09-30T00:00:00Z';
      doc.xBRIEFInfo.updated = '2026-09-30T00:00:00Z';
    }), 'chore: start');

    const result = await run();

    expect(result).toMatchObject({ failed: false });
    expect(result.evidence).toContain('spec unchanged beyond lifecycle status fields');
  });

  it('passes when the spec is unchanged after the trailer commit', async () => {
    branchOff();
    commitSpec(spec(), 'chore(plan): finalize', 'valid');
    write('src/code.ts', 'export const x = 1;\n');
    commit('feat: code');

    expect(await run()).toMatchObject({ failed: false });
  });

  it('uses a later valid trailer commit as the reference when re-planning changes an item', async () => {
    branchOff();
    commitSpec(spec(), 'chore(plan): finalize', 'valid');
    const replan = commitSpec(spec((doc) => { doc.plan.items[1].title = 'Re-planned y'; }), 'chore(plan): re-plan', 'valid');

    const result = await run();

    expect(result.failed).toBe(false);
    expect(result.evidence.split('\n')[0]).toBe(`reference: trailer ${replan.slice(0, 8)}`);
  });

  it('ignores a trailer whose hash does not match the spec blob and records it', async () => {
    branchOff();
    const forged = commitSpec(spec(), 'chore(plan): finalize', 'wrong');
    commitSpec(spec((doc) => { doc.plan.items[1].title = 'Changed'; }), 'edit');

    const result = await run();

    expect(result.failed).toBe(true);
    expect(result.evidence).toContain(`ignored Plan-Finalized trailer on ${forged.slice(0, 8)}: hash mismatch`);
    expect(result.evidence.split('\n')[0]).toBe(`reference: first-add ${forged.slice(0, 8)}`);
    expect(result.evidence).toContain('item y: changed title');
  });

  it('falls back to a legacy finalize subject that touches the spec', async () => {
    branchOff();
    const legacy = commitSpec(spec(), 'chore(plan): complete planning for pan-1');
    commitSpec(spec((doc) => { doc.plan.items = [doc.plan.items[0]]; }), 'drop y');

    const result = await run();

    expect(result.failed).toBe(true);
    expect(result.evidence.split('\n')[0]).toBe(`reference: legacy-finalize ${legacy.slice(0, 8)}`);
    expect(result.evidence).toContain('item y: removed');
  });

  it('uses the merge-base spec when the spec came from main', async () => {
    const onMain = commitSpec(spec(), 'plan on main');
    branchOff();
    commitSpec(spec((doc) => { doc.plan.narratives.Problem = 'rewritten'; }), 'edit narrative');

    const result = await run();

    expect(result.failed).toBe(true);
    expect(result.evidence.split('\n')[0]).toBe(`reference: merge-base ${onMain.slice(0, 8)}`);
    expect(result.evidence).toContain('plan.narratives: changed');
  });

  it('uses the first commit that added the spec when there is no finalize commit', async () => {
    branchOff();
    const added = commitSpec(spec(), 'feat: auto-start spec');
    commitSpec(spec((doc) => { doc.plan.items.push({ id: 'z', title: 'Item z', status: 'pending' }); }), 'add z');

    const result = await run();

    expect(result.failed).toBe(true);
    expect(result.evidence.split('\n')[0]).toBe(`reference: first-add ${added.slice(0, 8)}`);
    expect(result.evidence).toContain('item z: added');
  });

  it('fails an added second spec file for the issue', async () => {
    branchOff();
    commitSpec(spec(), 'chore(plan): finalize', 'valid');
    write('.pan/specs/2026-09-30-PAN-1-another.xbrief.json', spec());
    commit('second spec');

    const result = await run();

    expect(result.failed).toBe(true);
    expect(result.evidence).toContain('spec file added: .pan/specs/2026-09-30-PAN-1-another.xbrief.json');
  });

  it('passes a HEAD spec with conflict markers and defers to vbrief-conflicts', async () => {
    branchOff();
    commitSpec(spec(), 'chore(plan): finalize', 'valid');
    write(SPEC, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> main\n');
    commit('conflicted');

    const result = await run();

    expect(result.failed).toBe(false);
    expect(result.evidence).toContain('vbrief-conflicts');
  });

  it('passes a branch with no spec for the issue', async () => {
    branchOff();
    write('src/code.ts', 'export const x = 1;\n');
    commit('feat: code');

    expect(await run()).toEqual({ failed: false, evidence: 'no spec for PAN-1' });
  });

  it('passes a plan home that is not a git work tree', async () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);

    const result = await evaluatePlanIntegrityGate(ISSUE, plain, [{ repoKey: 'plain', dir: plain, targetBranch: 'main' }]);

    expect(result.failed).toBe(false);
    expect(result.evidence).toContain('not a git work tree');
  });

  it('fails closed with the git diagnostic when origin/<target> is missing', async () => {
    branchOff();
    commitSpec(spec(), 'chore(plan): finalize', 'valid');

    const result = await evaluatePlanIntegrityGate(ISSUE, repo, [{ repoKey: 'repo', dir: repo, targetBranch: 'no-such-branch' }]);

    expect(result.failed).toBe(true);
    expect(result.error).toContain('plan-integrity: git failed');
    expect(result.evidence).toContain('no-such-branch');
  });
});

describe('resolvePlanReference (PAN-1728)', () => {
  it('returns null when no commit or merge base holds a spec for the issue', async () => {
    branchOff();
    write('.pan/specs/2026-09-29-PAN-2-other.xbrief.json', spec());
    commit('other issue spec');

    expect(await resolvePlanReference(repo, ISSUE, 'origin/main')).toBeNull();
  });

  it('matches legacy lowercase spec filenames for the issue', async () => {
    branchOff();
    write('.pan/specs/2026-05-18-pan-1-legacy.vbrief.json', spec());
    const added = commit('legacy spec');

    expect(await resolvePlanReference(repo, ISSUE, 'origin/main')).toEqual({
      kind: 'first-add',
      sha: added,
      specPaths: ['.pan/specs/2026-05-18-pan-1-legacy.vbrief.json'],
      notes: [],
    });
  });
});
