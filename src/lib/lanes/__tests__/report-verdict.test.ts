/**
 * PAN-4223 WI-17: critic and verifier lanes file one verdict with their done
 * report. Real conversations DB in a temp OVERDECK_HOME; env injected.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-verdict-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation } = await import('../../overdeck/conversations.js');
const { listWorkerReports } = await import('../../agents/worker/report.js');
const { reportLane } = await import('../report.js');

// Critics run in detached worktrees; a plain directory reads as "no git" and is enough here.
const CWD = join(TEST_HOME, 'lanes');
mkdirSync(CWD, { recursive: true });
createConversation({ name: 'verdict-root', tmuxSession: 'conv-verdict-root', cwd: TEST_HOME, workspaceId: null });

function lane(name: string, role: 'critic' | 'verifier' | 'builder' | 'play' = 'critic') {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: CWD, workspaceId: null, parentName: 'verdict-root', lane: { run: 'hotel', key: name, role } });
  return { OVERDECK_CONVERSATION: `conv-${name}` };
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('reportLane verdicts (PAN-4223 WI-17)', () => {
  it('refuses a critic done report without a known verdict, and writes nothing', async () => {
    const env = lane('c-missing');
    await expect(reportLane({ body: '# verdict' }, env)).rejects.toThrow("a critic's done report needs --verdict");
    await expect(reportLane({ body: '# verdict', verdict: 'MAYBE' }, env)).rejects.toThrow("a critic's done report needs --verdict");
    expect(await listWorkerReports('conv-c-missing')).toEqual([]);
  });

  it('refuses --verdict on a builder and with --status blocked', async () => {
    const builder = lane('b-verdict', 'builder');
    await expect(reportLane({ body: 'x', verdict: 'PASS' }, builder)).rejects.toThrow('--verdict is for critic and verifier lanes');
    const critic = lane('c-blocked');
    await expect(reportLane({ body: 'x', status: 'blocked', verdict: 'PASS' }, critic)).rejects.toThrow('--verdict needs --status done');
  });

  it('stores the verdict with the defect count from the file and its absolute path', async () => {
    const env = lane('c-file');
    const file = join(TEST_HOME, 'critique-663-iter1.json');
    writeFileSync(file, JSON.stringify({ defects: [{}, {}, {}] }));
    expect(await reportLane({ body: '# not yet', verdict: 'NOT_YET', verdictFile: file }, env)).toBe('lane hotel/c-file report 1: done, verdict NOT_YET');
    const [report] = await listWorkerReports('conv-c-file');
    expect(report?.verdict).toEqual({ value: 'NOT_YET', defects: 3, file });
  });

  it('lets --defects win over the file and refuses a missing file', async () => {
    const env = lane('c-flag', 'verifier');
    const file = join(TEST_HOME, 'verify.json');
    writeFileSync(file, JSON.stringify({ defects: [{}] }));
    await expect(reportLane({ body: 'x', verdict: 'DEFECTS', verdictFile: join(TEST_HOME, 'nope.json') }, env)).rejects.toThrow('verdict file');
    await reportLane({ body: 'x', verdict: 'DEFECTS', verdictFile: file, defects: 7 }, env);
    expect((await listWorkerReports('conv-c-flag'))[0]?.verdict).toEqual({ value: 'DEFECTS', defects: 7, file });
  });

  it('allows one verdict per critic, and a blocked report needs none', async () => {
    const env = lane('c-once');
    expect(await reportLane({ body: 'RULING needed', status: 'blocked' }, env)).toBe('lane hotel/c-once report 1: blocked');
    await reportLane({ body: '# wowed', verdict: 'WOWED' }, env);
    await expect(reportLane({ body: '# again', verdict: 'WOWED' }, env)).rejects.toThrow('one verdict per critic; launch a fresh critic');
    expect(await listWorkerReports('conv-c-once')).toHaveLength(2);
  });
});
