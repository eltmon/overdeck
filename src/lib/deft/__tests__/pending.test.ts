/**
 * PAN-4849 WI-4: open Deft escalations become pending questions on the work
 * agent, and the dialog's answer resolves the escalation file (BD-9).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deliverAgentMessage = vi.hoisted(() => vi.fn());
vi.mock('../../agents/delivery.js', () => ({ deliverAgentMessage }));

const { readDeftIssueState } = await import('../state-reader.js');
const { clearDeftPendingCache, deftEscalationQuestions, deftIssueForAgent, deftMenuQuestion } = await import('../pending.js');
const { answerDeftEscalation, answerDeftMenu, mapDeftEscalationAnswer } = await import('../pending-answer.js');

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/directive', import.meta.url));
const NOW = Date.parse('2026-11-02T18:00:00Z');

const scratch = mkdtempSync(join(tmpdir(), 'deft-pending-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function depsFor(worktree: string) {
  const readState = vi.fn((root: string, issueId: string, now: number) =>
    readDeftIssueState(root, issueId, now, { isNativeDirectiveProject: async () => false }));
  return {
    readState,
    deps: { isDeft: async () => true, agentWorkspace: () => worktree, readState, now: () => Date.now() },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  clearDeftPendingCache();
  deliverAgentMessage.mockReset();
  deliverAgentMessage.mockResolvedValue({ ok: true, path: 'herdr' });
});
afterEach(() => vi.useRealTimers());

describe('deftIssueForAgent', () => {
  it('accepts only a Deft work agent', async () => {
    const deps = { isDeft: async (id: string) => id === 'PAN-1', agentWorkspace: () => FIXTURE_DIR };
    expect(await deftIssueForAgent('agent-pan-1', deps)).toEqual({ issueId: 'PAN-1', worktree: FIXTURE_DIR });
    expect(await deftIssueForAgent('agent-pan-2', deps)).toBeNull();
    expect(await deftIssueForAgent('planning-pan-1', deps)).toBeNull();
    expect(await deftIssueForAgent('agent-pan-1', { ...deps, agentWorkspace: () => null })).toBeNull();
  });
});

describe('cached Deft pipeline check (PAN-4849 review)', () => {
  it('asks once per issue per 10 s across the escalation and menu lookups, and forgets on clear', async () => {
    const isDeft = vi.fn(async () => false);
    const deps = { isDeft, agentWorkspace: () => FIXTURE_DIR, now: () => Date.now() };
    await deftEscalationQuestions('agent-pan-1', deps);
    await deftMenuQuestion('agent-pan-1', null, deps);
    expect(isDeft).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_001);
    await deftEscalationQuestions('agent-pan-1', deps);
    expect(isDeft).toHaveBeenCalledTimes(2);
    clearDeftPendingCache();
    await deftEscalationQuestions('agent-pan-1', deps);
    expect(isDeft).toHaveBeenCalledTimes(3);
  });
});

describe('deftEscalationQuestions', () => {
  it('offers the open blocking escalations and counts the open external one', async () => {
    const { deps } = depsFor(FIXTURE_DIR);
    const result = await deftEscalationQuestions('agent-pan-1', deps);

    expect(result.externalCount).toBe(1);
    expect(result.questions.map(q => q.toolId)).toEqual([
      'deft-escalation:esc-20261102120000-aaaaaa',
      'deft-escalation:esc-20261102120100-bbbbbb',
    ]);
    expect(result.questions[0]).toEqual({
      toolId: 'deft-escalation:esc-20261102120000-aaaaaa',
      timestamp: '2026-11-02T12:00:00Z',
      questions: [{
        header: 'cmd_approval',
        question: 'Run the database migration',
        context: 'npm run migrate drops the old table.\n\nSLA 1h (due 2026-11-02T13:00:00.000Z)\nDANGEROUS',
        multiSelect: false,
        options: [
          { label: 'Approve', description: 'Resolve as approved' },
          { label: 'Deny', description: 'Resolve as denied' },
          { label: 'Dismiss', description: 'Resolve as dismissed' },
        ],
      }],
    });
    expect(result.questions[1]!.questions[0]).toMatchObject({
      header: 'question',
      question: 'Which table layout?\n\nType your answer in the note.',
      options: [{ label: 'Dismiss', description: 'Resolve as dismissed' }],
    });
  });

  it('returns nothing for an agent that is not on a Deft issue', async () => {
    const { deps } = depsFor(FIXTURE_DIR);
    expect(await deftEscalationQuestions('agent-pan-1', { ...deps, isDeft: async () => false })).toEqual({ questions: [], externalCount: 0 });
  });

  it('reuses the read for 10 seconds, then reads again', async () => {
    const { deps, readState } = depsFor(FIXTURE_DIR);
    await deftEscalationQuestions('agent-pan-1', deps);
    vi.advanceTimersByTime(9_000);
    await deftEscalationQuestions('agent-pan-1', deps);
    expect(readState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await deftEscalationQuestions('agent-pan-1', deps);
    expect(readState).toHaveBeenCalledTimes(2);
  });
});

describe('mapDeftEscalationAnswer (BD-9)', () => {
  it('maps the three labels, a note, and free text', () => {
    expect(mapDeftEscalationAnswer('Approve')).toEqual({ decision: 'approved' });
    expect(mapDeftEscalationAnswer('Deny\n\nNote: too risky')).toEqual({ decision: 'denied', note: 'too risky' });
    expect(mapDeftEscalationAnswer('Dismiss')).toEqual({ decision: 'dismissed' });
    expect(mapDeftEscalationAnswer('use port 8080')).toEqual({ decision: 'answered', answer: 'use port 8080' });
  });
});

describe('answerDeftEscalation', () => {
  function copy(): string {
    const root = mkdtempSync(join(scratch, 'wt-'));
    cpSync(FIXTURE_DIR, root, { recursive: true });
    return root;
  }
  const readEscalation = (root: string, id: string) =>
    JSON.parse(readFileSync(join(root, '.deft', 'escalations', `${id}.json`), 'utf8'));

  it('resolves the file from the dialog answer and tells the agent', async () => {
    const root = copy();
    const { deps } = depsFor(root);
    const res = await answerDeftEscalation('agent-pan-1', 'deft-escalation:esc-20261102120000-aaaaaa', 'Deny\n\nNote: too risky', deps);

    expect(res).toEqual({ status: 200, body: { success: true, agentId: 'agent-pan-1', resolved: true, delivered: 1 } });
    expect(readEscalation(root, 'esc-20261102120000-aaaaaa')).toMatchObject({
      status: 'resolved',
      resolution: { decision: 'denied', note: 'too risky', answer: null, resolvedBy: 'operator:dashboard' },
    });
    expect(deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-1',
      'Operator resolved Deft escalation esc-20261102120000-aaaaaa: denied',
      'deft-escalation-answer',
    );
  });

  it('records a free-text answer and refuses a second answer with 409', async () => {
    const root = copy();
    const { deps } = depsFor(root);
    const toolId = 'deft-escalation:esc-20261102120100-bbbbbb';
    expect((await answerDeftEscalation('agent-pan-1', toolId, 'use port 8080', deps)).status).toBe(200);
    expect(readEscalation(root, 'esc-20261102120100-bbbbbb').resolution).toMatchObject({ decision: 'answered', answer: 'use port 8080' });
    expect((await answerDeftEscalation('agent-pan-1', toolId, 'Dismiss', deps)).status).toBe(409);
  });

  it('returns 404 for an unknown escalation', async () => {
    const { deps } = depsFor(copy());
    expect((await answerDeftEscalation('agent-pan-1', 'deft-escalation:esc-20990101000000-ffffff', 'Approve', deps)).status).toBe(404);
  });
});

describe('deftMenuQuestion', () => {
  const deps = { isDeft: async () => true, agentWorkspace: () => FIXTURE_DIR };
  const menuText = 'How do you want to proceed?\n1. Accept\n2. Approve\n3. Discuss\n4. Back';
  const assistant = (id: string, content: unknown[], timestamp = '2026-11-02T17:00:00Z') =>
    JSON.stringify({ type: 'assistant', timestamp, message: { id, role: 'assistant', content } });

  function transcript(lines: string[]): string {
    const path = join(mkdtempSync(join(scratch, 'jsonl-')), 'session.jsonl');
    writeFileSync(path, `${lines.join('\n')}\n`);
    return path;
  }

  it('offers the menu in the last assistant message with verbatim labels', async () => {
    const path = transcript([
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }),
      assistant('msg_1', [{ type: 'thinking', thinking: 'hmm' }]),
      assistant('msg_1', [{ type: 'text', text: menuText }]),
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
    ]);
    const question = await deftMenuQuestion('agent-pan-1', path, deps);
    expect(question).toMatchObject({
      timestamp: '2026-11-02T17:00:00Z',
      questions: [{
        header: 'Deft',
        question: 'How do you want to proceed?',
        multiSelect: false,
        options: ['1. Accept', '2. Approve', '3. Discuss', '4. Back'].map(label => ({ label, description: '' })),
      }],
    });
    expect(question?.toolId).toMatch(/^deft-menu:[0-9a-f]{12}$/);
  });

  it('returns null when the last message calls a tool, is from the user, or the issue is not on Deft', async () => {
    const withTool = transcript([assistant('msg_2', [{ type: 'text', text: menuText }, { type: 'tool_use', id: 't', name: 'Bash', input: {} }])]);
    expect(await deftMenuQuestion('agent-pan-1', withTool, deps)).toBeNull();
    const userLast = transcript([assistant('msg_3', [{ type: 'text', text: menuText }]), JSON.stringify({ type: 'user', message: { content: '1' } })]);
    expect(await deftMenuQuestion('agent-pan-1', userLast, deps)).toBeNull();
    const menuLast = transcript([assistant('msg_4', [{ type: 'text', text: menuText }])]);
    clearDeftPendingCache(); // a pipeline switch clears the cached "is on Deft" answer
    expect(await deftMenuQuestion('agent-pan-1', menuLast, { ...deps, isDeft: async () => false })).toBeNull();
  });
});

describe('answerDeftMenu (BD-10)', () => {
  const options = ['1. Accept', '2. Approve', '3. Discuss', '4. Back'];

  it('delivers the exact label and drops a note', async () => {
    expect(await answerDeftMenu('agent-pan-1', 'deft-menu:abc', '2. Approve', options)).toEqual({
      status: 200,
      body: { success: true, agentId: 'agent-pan-1', delivered: 1 },
    });
    expect(deliverAgentMessage).toHaveBeenLastCalledWith('agent-pan-1', '2. Approve', 'deft-menu-answer');
    await answerDeftMenu('agent-pan-1', 'deft-menu:abc', '2. Approve\n\nNote: x', options);
    expect(deliverAgentMessage).toHaveBeenLastCalledWith('agent-pan-1', '2. Approve', 'deft-menu-answer');
  });

  it('refuses a label without its number, or a bare note, with 400', async () => {
    const refusal = { status: 400, body: { error: 'Deft menus take one option; reply in the terminal for anything else' } };
    expect(await answerDeftMenu('agent-pan-1', 'deft-menu:abc', 'Approve', options)).toEqual(refusal);
    expect(await answerDeftMenu('agent-pan-1', 'deft-menu:abc', 'please wait', options)).toEqual(refusal);
    expect(deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('returns 502 when delivery fails', async () => {
    deliverAgentMessage.mockResolvedValueOnce({ ok: false, path: 'herdr', failure: 'no pane' });
    expect((await answerDeftMenu('agent-pan-1', 'deft-menu:abc', '1. Accept', options)).status).toBe(502);
  });
});
