/** Map one pending item plus the user's choice to exactly one Overdeck answer tool call
 * (PAN-4954 WI-6, D-7, D-8, NFR-2; PAN-4927 W-INT2). Arguments are built literally from named
 * fields of the item; nothing from the model's input is spread into them (MYN review W2). */
import { choicesText, KIND_LABEL, oneLine, type PendingItem } from './pending.js';

export type AnswerPlan = { ok: true; tool: string; arguments: Record<string, unknown>; done: string } | { ok: false; error: string };

const MAX_CHOICE_LENGTH = 2000;
const PERMISSION_CHOICES = ['allow-once', 'allow-always', 'deny'];
const AGENT_PERMISSION_CHOICES = ['allow', 'deny'];
const PLAN_ACTIONS = ['approve-auto', 'approve-manual', 'reject-ultraplan'];

/** An option number, an exact option label ignoring case, or else the text itself (free text). */
export function resolveOption(choice: string, options: string[]): string {
  if (/^\d+$/.test(choice)) {
    const n = Number(choice);
    if (n >= 1 && n <= options.length) return options[n - 1]!;
  }
  return options.find((label) => label.toLowerCase() === choice.toLowerCase()) ?? choice;
}

type PlanChoice = { action: string; feedback?: string };

function readPlanChoice(choice: string): PlanChoice | null {
  const lower = choice.toLowerCase();
  if (PLAN_ACTIONS.includes(lower)) return { action: lower };
  const feedback = /^reject-feedback:(.*)$/is.exec(choice)?.[1]?.trim();
  return feedback ? { action: 'reject-feedback', feedback } : null;
}

export function planAnswer(item: PendingItem, choice: string): AnswerPlan {
  const c = choice.trim();
  if (c === '') return { ok: false, error: 'choice is empty' };
  if (c.length > MAX_CHOICE_LENGTH) return { ok: false, error: `choice is longer than ${MAX_CHOICE_LENGTH} characters` };
  if (!item.answerable) return { ok: false, error: item.reason ?? 'answer it in the Overdeck dashboard' };

  const refuse: AnswerPlan = { ok: false, error: `choice must be one of: ${choicesText(item)}` };
  const answered = (tool: string, args: Record<string, unknown>, answer: string): AnswerPlan => ({
    ok: true,
    tool,
    arguments: args,
    done: `Answered item ${item.n} (${KIND_LABEL[item.kind]} in "${oneLine(item.label, 80)}" on ${oneLine(item.machine, 80)}) with "${oneLine(answer, 120)}".`,
  });
  const conversation = item.conversation;
  const agentId = item.agentId;

  switch (item.kind) {
    case 'permission': {
      const lower = c.toLowerCase();
      if (!PERMISSION_CHOICES.includes(lower)) return refuse;
      return answered('answer_permission', { conversation, signature: item.signature, choice: lower }, lower);
    }
    case 'question': {
      const resolved = resolveOption(c, item.options);
      return answered('answer_question', { conversation, answers: [resolved], questions: [item.question] }, resolved);
    }
    case 'pi-ask': {
      const resolved = resolveOption(c, item.options);
      return answered('answer_pi_ask', { conversation, toolUseId: item.toolUseId, answers: [resolved] }, resolved);
    }
    case 'codex-approval': {
      const n = /^\d+$/.test(c) ? Number(c) : Number.NaN;
      if (!(n >= 1 && n <= 9) || (item.options.length > 0 && n > item.options.length)) return refuse;
      return answered('answer_codex_approval', { conversation, optionNumber: n, toolUseId: item.toolUseId }, item.options[n - 1] ?? String(n));
    }
    case 'plan':
    case 'agent-plan': {
      const plan = readPlanChoice(c);
      if (!plan) return refuse;
      const args: Record<string, unknown> = item.kind === 'plan' ? { conversation, action: plan.action } : { agentId, action: plan.action };
      if (plan.feedback !== undefined) args.feedback = plan.feedback;
      return answered(item.kind === 'plan' ? 'answer_plan' : 'answer_agent_plan', args, plan.action);
    }
    case 'pane-choice': {
      const index = /^\d+$/.test(c) ? (item.paneNumbers ?? []).indexOf(Number(c)) : -1;
      if (index < 0) return refuse;
      return answered('answer_pane_choice', { conversation, selectedIndex: index, signature: item.signature }, item.options[index] ?? c);
    }
    case 'agent-question': {
      const resolved = resolveOption(c, item.options);
      return answered('answer_question', { agentId, toolUseId: item.toolUseId, answers: [resolved] }, resolved);
    }
    case 'agent-permission': {
      const lower = c.toLowerCase();
      if (!AGENT_PERMISSION_CHOICES.includes(lower)) return refuse;
      return answered('answer_agent_permission', { agentId, requestId: item.requestId, behavior: lower }, lower);
    }
    case 'dashboard-only':
      return { ok: false, error: item.reason ?? 'answer it in the Overdeck dashboard' };
  }
}
