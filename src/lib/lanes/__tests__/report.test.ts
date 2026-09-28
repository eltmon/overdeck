/**
 * PAN-4223 WI-6 step 3: reportLane against a real conversations DB (temp
 * OVERDECK_HOME) and real temporary git repos.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-report-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation } = await import('../../overdeck/conversations.js');
const { listWorkerReports } = await import('../../agents/worker/report.js');
const { reportLane } = await import('../report.js');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Lane Test',
      GIT_AUTHOR_EMAIL: 'lane@test.invalid',
      GIT_COMMITTER_NAME: 'Lane Test',
      GIT_COMMITTER_EMAIL: 'lane@test.invalid',
    },
  }).trim();
}

/** A clone of a bare remote, on branch `branch` pushed with upstream. */
function repo(name: string, branch: string): string {
  const remote = join(TEST_HOME, `${name}.git`);
  const work = join(TEST_HOME, name);
  git(TEST_HOME, 'init', '-q', '--bare', '-b', 'main', remote);
  git(TEST_HOME, 'clone', '-q', remote, work);
  git(work, 'checkout', '-q', '-b', branch);
  writeFileSync(join(work, 'a.txt'), 'one\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'first');
  git(work, 'push', '-q', '-u', 'origin', branch);
  return work;
}

createConversation({ name: 'report-root', tmuxSession: 'conv-report-root', cwd: TEST_HOME, workspaceId: null });

function lane(name: string, cwd: string, role: 'builder' | 'critic' | 'play' = 'builder'): { OVERDECK_CONVERSATION: string } {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd, workspaceId: null, parentName: 'report-root', lane: { run: 'hotel', key: name, role } });
  return { OVERDECK_CONVERSATION: `conv-${name}` };
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('reportLane (PAN-4223 WI-6)', () => {
  it('refuses outside a lane, including in a successor of a lane', async () => {
    await expect(reportLane({ body: 'x' }, {})).rejects.toThrow('not inside a lane');
    await expect(reportLane({ body: 'x' }, { OVERDECK_CONVERSATION: 'conv-report-root' })).rejects.toThrow('not inside a lane');
    lane('succ-src', TEST_HOME, 'play');
    createConversation({ name: 'succ', tmuxSession: 'conv-succ', cwd: TEST_HOME, workspaceId: null, parentName: 'succ-src' });
    await expect(reportLane({ body: 'x' }, { OVERDECK_CONVERSATION: 'conv-succ' })).rejects.toThrow('not inside a lane');
  });

  it('writes a clean, pushed builder done report with head and branch', async () => {
    const work = repo('clean', 'hotel/clean');
    const env = lane('clean', work);
    expect(await reportLane({ body: '# done' }, env)).toBe('lane hotel/clean report 1: done');
    const [report] = await listWorkerReports('conv-clean');
    expect(report).toMatchObject({ status: 'done', body: '# done', git: { head: git(work, 'rev-parse', 'HEAD'), branch: 'hotel/clean' } });
  });

  it('refuses a builder done report from a dirty tree and writes nothing', async () => {
    const work = repo('dirty', 'hotel/dirty');
    const env = lane('dirty', work);
    writeFileSync(join(work, 'a.txt'), 'changed\n');
    await expect(reportLane({ body: '# done' }, env)).rejects.toThrow(/dirty/);
    await expect(reportLane({ body: '# done', allowUnpushed: true }, env)).rejects.toThrow(/dirty/);
    expect(await listWorkerReports('conv-dirty')).toEqual([]);
  });

  it('refuses unpushed commits and a branch without upstream unless allowUnpushed', async () => {
    const work = repo('ahead', 'hotel/ahead');
    const env = lane('ahead', work);
    writeFileSync(join(work, 'b.txt'), 'two\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'second');
    await expect(reportLane({ body: '# done' }, env)).rejects.toThrow(/1 commit\(s\) not on its upstream/);

    git(work, 'checkout', '-q', '-b', 'hotel/local-only');
    await expect(reportLane({ body: '# done' }, env)).rejects.toThrow(/no upstream/);
    expect(await listWorkerReports('conv-ahead')).toEqual([]);

    expect(await reportLane({ body: '# done', allowUnpushed: true }, env)).toBe('lane hotel/ahead report 1: done');
    const [report] = await listWorkerReports('conv-ahead');
    expect(report?.git).toEqual({ head: git(work, 'rev-parse', 'HEAD'), branch: 'hotel/local-only' });
  });

  it('lets a builder report blocked from a dirty tree, and a play lane report without git', async () => {
    const work = repo('blocked', 'hotel/blocked');
    const env = lane('blocked', work);
    writeFileSync(join(work, 'a.txt'), 'changed\n');
    expect(await reportLane({ body: 'RULING needed', status: 'blocked' }, env)).toBe('lane hotel/blocked report 1: blocked');

    const playEnv = lane('cold', join(TEST_HOME, 'play-dir'), 'play');
    expect(await reportLane({ body: '# confusion log' }, playEnv)).toBe('lane hotel/cold report 1: done');
    const [report] = await listWorkerReports('conv-cold');
    expect(report?.git).toBeUndefined();
  });
});
