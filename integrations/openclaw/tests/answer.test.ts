import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planAnswer, resolveOption } from '../src/answer.js';
import { parsePendingInput, type PendingItem } from '../src/pending.js';

const ITEMS = parsePendingInput(readFileSync(new URL('./fixtures/pending-input.json', import.meta.url), 'utf8'));

function item(kind: PendingItem['kind'], n?: number): PendingItem {
  const found = ITEMS.find((candidate) => candidate.kind === kind && (n === undefined || candidate.n === n));
  if (!found) throw new Error(`fixture has no ${kind}`);
  return found;
}

function expectPlan(target: PendingItem, choice: string, tool: string, args: Record<string, unknown>) {
  const plan = planAnswer(target, choice);
  expect(plan.ok).toBe(true);
  if (plan.ok) {
    expect(plan.tool).toBe(tool);
    expect(plan.arguments).toEqual(args);
  }
  return plan;
}

function expectError(target: PendingItem, choice: string, error: string) {
  expect(planAnswer(target, choice)).toEqual({ ok: false, error });
}

describe('planAnswer mapping', () => {
  it('permission → answer_permission', () => {
    const plan = expectPlan(item('permission'), ' Allow-Once ', 'answer_permission', { conversation: 'conv-alpha', signature: 'sig-alpha-1', choice: 'allow-once' });
    if (plan.ok) expect(plan.done).toBe('Answered item 1 (permission prompt in "Fix the login bug" on this machine) with "allow-once".');
  });

  it('question → answer_question', () => {
    expectPlan(item('question', 2), '2', 'answer_question', { conversation: 'conv-alpha', answers: ['Postgres'], questions: ['Which database should I use?'] });
  });

  it('pi-ask → answer_pi_ask', () => {
    expectPlan(item('pi-ask'), 'yes', 'answer_pi_ask', { conversation: 'conv-pi', toolUseId: 'pi_ask_1', answers: ['Yes'] });
  });

  it('codex-approval → answer_codex_approval', () => {
    const plan = expectPlan(item('codex-approval'), '3', 'answer_codex_approval', { conversation: 'conv-codex', optionNumber: 3, toolUseId: 'codex-approval:call_77' });
    if (plan.ok) expect(plan.done).toContain('with "No".');
  });

  it('plan → answer_plan, with feedback for reject-feedback', () => {
    expectPlan(item('plan'), 'approve-auto', 'answer_plan', { conversation: 'conv-plan', action: 'approve-auto' });
    expectPlan(item('plan'), 'reject-feedback: use Redis instead', 'answer_plan', { conversation: 'conv-plan', action: 'reject-feedback', feedback: 'use Redis instead' });
  });

  it('pane-choice → answer_pane_choice with the index of the number', () => {
    expectPlan(item('pane-choice'), '2', 'answer_pane_choice', { conversation: 'conv-pane', selectedIndex: 1, signature: 'pane-sig-1' });
  });

  it('agent-question → answer_question by agent', () => {
    expectPlan(item('agent-question'), 'keep', 'answer_question', { agentId: 'agent-pan-202', toolUseId: 'toolu_agent_ask', answers: ['Keep'] });
  });

  it('agent-permission → answer_agent_permission', () => {
    expectPlan(item('agent-permission', 12), 'DENY', 'answer_agent_permission', { agentId: 'agent-pan-202', requestId: 'req-2', behavior: 'deny' });
  });

  it('agent-plan → answer_agent_plan', () => {
    expectPlan(item('agent-plan', 13), 'reject-ultraplan', 'answer_agent_plan', { agentId: 'agent-pan-202', action: 'reject-ultraplan' });
    expectPlan(item('agent-plan', 13), 'reject-feedback: smaller steps', 'answer_agent_plan', { agentId: 'agent-pan-202', action: 'reject-feedback', feedback: 'smaller steps' });
  });

  it('answers a linked conversation by its prefixed name', () => {
    expectPlan(item('question', 15), 'Deploy', 'answer_question', { conversation: '@env-1/conv-remote', answers: ['Deploy'], questions: ['Deploy now?'] });
  });
});

describe('resolveOption', () => {
  const options = ['SQLite', 'Postgres'];

  it('resolves by number, by label in another case, else free text', () => {
    expect(resolveOption('1', options)).toBe('SQLite');
    expect(resolveOption('postgres', options)).toBe('Postgres');
    expect(resolveOption('3', options)).toBe('3');
    expect(resolveOption('MySQL please', options)).toBe('MySQL please');
  });

  it('sends free text through a question', () => {
    expectPlan(item('question', 2), 'MySQL please', 'answer_question', { conversation: 'conv-alpha', answers: ['MySQL please'], questions: ['Which database should I use?'] });
  });
});

describe('planAnswer refusals', () => {
  it('refuses an item that cannot be answered, with its reason', () => {
    expectError(item('question', 5), 'A', 'this prompt has 2 questions; use the answer_question tool or the Overdeck dashboard');
    expectError(item('agent-plan', 16), 'approve-auto', 'this agent runs on a linked machine; answer it on that machine');
    expectError(item('dashboard-only', 8), 'go', 'release it in the Overdeck dashboard');
  });

  it('refuses an empty or overlong choice', () => {
    expectError(item('permission'), '   ', 'choice is empty');
    expectError(item('question', 2), 'x'.repeat(2001), 'choice is longer than 2000 characters');
  });

  it('refuses a choice outside the accepted set', () => {
    expectError(item('permission'), 'allow', 'choice must be one of: allow-once, allow-always, deny');
    expectError(item('pane-choice'), '9', 'choice must be one of: 1) Latest, 2) Older');
    expectError(item('plan'), 'reject-feedback:', 'choice must be one of: approve-auto, approve-manual, reject-ultraplan, reject-feedback: <what to change>');
    expectError(item('codex-approval'), '4', "choice must be one of: 1) Yes, 2) Yes, and don't ask again, 3) No");
    expectError(item('agent-permission', 11), 'allow-once', 'choice must be one of: allow, deny');
  });
});
