/**
 * The approval tools of the Overdeck MCP server (PAN-4649 FR-5):
 * `list_pending_input`, `answer_question` and `answer_permission`.
 *
 * `answer_permission` proxies `POST /api/conversations/:id/permission`, which
 * the route-scope table maps to `approve`. `answer_question` posts the same
 * composed message the dashboard sends for a Claude Code AskUserQuestion, and
 * that message route needs only `tell`, so this tool checks `approve` itself
 * (D-4649-5) and serves only harnesses that declare `answersQuestionByMessage`
 * — today Claude Code (D-4649-6).
 */
import { getHarnessBehavior, normalizeHarnessName } from '@overdeck/contracts';

import { scopeSatisfies } from '../access-tokens.js';
import { errorResult, isOk, requiredString, routeErrorResult, routeResult, type OverdeckTool } from './tool.js';

const PERMISSION_CHOICES = ['allow-once', 'allow-always', 'deny'] as const;

export const MISSING_APPROVE_TEXT =
  'This token lacks the approve scope. Create one with "Allow answering questions and approving permissions" checked.';
export const NOT_CLAUDE_CODE_TEXT = 'answer_question supports Claude Code conversations; answer this one from the dashboard';

/** The message the dashboard composes for answered AskUserQuestion prompts. */
export function composeQuestionAnswer(answers: readonly string[], questions?: readonly string[]): string {
  const lines = answers.map((answer, i) => `Q: ${questions?.[i] ?? `Question ${i + 1}`}\nA: ${answer}`);
  return `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;
}

/**
 * True when the conversation's harness answers a pending question through a
 * composed message (`answersQuestionByMessage`). A missing or null harness is
 * Claude Code; an unrecognized harness name is refused.
 */
function answersQuestionByMessage(conversation: unknown): boolean {
  const harness = conversation && typeof conversation === 'object' ? (conversation as Record<string, unknown>)['harness'] : undefined;
  if (harness !== undefined && harness !== null && normalizeHarnessName(harness) === null) return false;
  return getHarnessBehavior(normalizeHarnessName(harness)).capabilities.answersQuestionByMessage;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? (value as string[]) : null;
}

const listPendingInput: OverdeckTool = {
  name: 'list_pending_input',
  description: 'List conversations waiting on input: questions, permission prompts, plan approvals and menus.',
  scope: 'read:conversations',
  audience: 'any',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    return routeResult(await ctx.api.request('GET', '/api/conversations/pending-input'));
  },
};

const answerQuestion: OverdeckTool = {
  name: 'answer_question',
  description: 'Answer the pending question of a Claude Code conversation. Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id.' },
      answers: { type: 'array', items: { type: 'string' }, description: 'One answer per pending question, in order.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'The question texts, in the same order, quoted in the reply.' },
    },
    required: ['conversation', 'answers'],
  },
  async run(args, ctx) {
    if (!scopeSatisfies(ctx.scopes, 'approve')) return errorResult(MISSING_APPROVE_TEXT);
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const answers = stringArray(args['answers']);
    if (!answers || answers.length === 0) return errorResult('answers is required and must be a non-empty array of strings');
    const questions = args['questions'] === undefined ? undefined : stringArray(args['questions']);
    if (questions === null) return errorResult('questions must be an array of strings');

    const name = encodeURIComponent(conversation.value);
    const read = await ctx.api.request('GET', `/api/conversations/${name}`);
    if (!isOk(read)) return routeErrorResult(read);
    if (!answersQuestionByMessage(read.json)) return errorResult(NOT_CLAUDE_CODE_TEXT);

    const message = composeQuestionAnswer(answers, questions);
    return routeResult(await ctx.api.request('POST', `/api/conversations/${name}/message`, { message }));
  },
};

const answerPermission: OverdeckTool = {
  name: 'answer_permission',
  description: 'Answer a Claude Code permission prompt shown in a conversation. Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id.' },
      signature: { type: 'string', description: 'The prompt signature from list_pending_input.' },
      choice: { type: 'string', enum: [...PERMISSION_CHOICES], description: 'allow-once, allow-always or deny.' },
    },
    required: ['conversation', 'signature', 'choice'],
  },
  async run(args, ctx) {
    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const signature = requiredString(args, 'signature');
    if (!signature.ok) return signature.error;
    const choice = args['choice'];
    if (typeof choice !== 'string' || !(PERMISSION_CHOICES as readonly string[]).includes(choice)) {
      return errorResult(`choice must be one of ${PERMISSION_CHOICES.join(', ')}`);
    }
    const path = `/api/conversations/${encodeURIComponent(conversation.value)}/permission`;
    return routeResult(await ctx.api.request('POST', path, { signature: signature.value, choice }));
  },
};

export const APPROVE_TOOLS: readonly OverdeckTool[] = [listPendingInput, answerQuestion, answerPermission];
