/**
 * The approval tools of the Overdeck MCP server (PAN-4649 FR-5, PAN-4944 PAN-4927
 * W-APPR1): `list_pending_input`, `answer_question`, `answer_permission`,
 * `answer_pane_choice`, `answer_codex_approval`, `answer_pi_ask` and
 * `answer_plan`.
 *
 * `answer_permission` proxies `POST /api/conversations/:id/permission`, which
 * the route-scope table maps to `approve`. `answer_question` posts the same
 * composed message the dashboard sends for a Claude Code AskUserQuestion, and
 * that message route needs only `tell`, so this tool checks `approve` itself
 * (D-4649-5) and serves only harnesses that declare `answersQuestionByMessage`
 * — today Claude Code (D-4649-6). The other four tools each proxy exactly one
 * `approve`-scoped conversation route (PAN-4944 D-1, NFR-1).
 */
import { getHarnessBehavior, normalizeHarnessName, type HarnessAskAnswerDelivery } from '@overdeck/contracts';

import { scopeSatisfies } from '../access-tokens.js';
import { errorResult, isOk, jsonResult, optionalInteger, optionalString, requiredString, routeErrorResult, routeResult, type ArgResult, type OverdeckTool } from './tool.js';

const PERMISSION_CHOICES = ['allow-once', 'allow-always', 'deny'] as const;

/** The four plan actions `deliverPlanActionToSession` accepts (conversation-delivery.ts:58-62, 87). Copied: src/lib/mcp imports no server code. */
export const PLAN_ACTIONS = ['approve-auto', 'approve-manual', 'reject-ultraplan', 'reject-feedback'] as const;

/** A required integer argument within `[min, max]`. */
function requiredInteger(args: Record<string, unknown>, field: string, min: number, max: number): ArgResult<number> {
  const parsed = optionalInteger(args, field, min, max, undefined);
  if (!parsed.ok) return parsed;
  if (parsed.value === undefined) return { ok: false, error: errorResult(`${field} is required and must be an integer from ${min} to ${max}`) };
  return { ok: true, value: parsed.value };
}

/** The `conversation` argument, URL-encoded as one path segment (`@<machine>/<name>` stays one segment). */
function conversationPath(args: Record<string, unknown>, suffix: string): ArgResult<string> {
  const conversation = requiredString(args, 'conversation');
  if (!conversation.ok) return conversation;
  return { ok: true, value: `/api/conversations/${encodeURIComponent(conversation.value)}/${suffix}` };
}

const CONVERSATION_PROPERTY = { type: 'string', description: 'The conversation name or id; @<machine>/<name> for one on a linked machine.' } as const;

export const AGENT_ON_LINKED_MACHINE_TEXT =
  'agentId names an agent on a linked machine; answer it on that machine. These tools reach agents on this machine only.';

/** The `agentId` argument as an encoded path segment; refuses `@<machine>/…` ids (D-4). */
function agentIdArg(args: Record<string, unknown>): ArgResult<string> {
  const agentId = requiredString(args, 'agentId');
  if (!agentId.ok) return agentId;
  if (agentId.value.startsWith('@')) return { ok: false, error: errorResult(AGENT_ON_LINKED_MACHINE_TEXT) };
  return { ok: true, value: encodeURIComponent(agentId.value) };
}

export const MISSING_APPROVE_TEXT =
  'This token lacks the approve scope. Create one with "Allow answering questions and approving permissions" checked.';
export const NOT_CLAUDE_CODE_TEXT = 'answer_question supports Claude Code conversations; answer this one from the dashboard';
export const NOT_CLAUDE_CODE_PI_TEXT = 'answer_question cannot answer a Pi ask; use answer_pi_ask with the toolUseId from list_pending_input';
export const NOT_CLAUDE_CODE_CODEX_TEXT = 'answer_question cannot answer a Codex approval; use answer_codex_approval with the option number and toolUseId from list_pending_input';

/** The message the dashboard composes for answered AskUserQuestion prompts. */
export function composeQuestionAnswer(answers: readonly string[], questions?: readonly string[]): string {
  const lines = answers.map((answer, i) => `Q: ${questions?.[i] ?? `Question ${i + 1}`}\nA: ${answer}`);
  return `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;
}

/**
 * `null` when the conversation's harness answers a pending question through a
 * composed message (`answersQuestionByMessage`); otherwise the refusal text
 * naming the right tool. A missing or null harness is Claude Code. An
 * unrecognized harness name gets `NOT_CLAUDE_CODE_TEXT` (FR-9).
 */
function questionRedirectText(conversation: unknown): string | null {
  const harnessField = conversation && typeof conversation === 'object' ? (conversation as Record<string, unknown>)['harness'] : undefined;
  const harness = normalizeHarnessName(harnessField);
  if (harnessField !== undefined && harnessField !== null && harness === null) return NOT_CLAUDE_CODE_TEXT;
  const behavior = getHarnessBehavior(harness);
  const delivery: HarnessAskAnswerDelivery = behavior.capabilities.askAnswerDelivery;
  if (delivery === 'pi-ask-modal') return NOT_CLAUDE_CODE_PI_TEXT;
  if (delivery === 'codex-approval') return NOT_CLAUDE_CODE_CODEX_TEXT;
  return behavior.capabilities.answersQuestionByMessage ? null : NOT_CLAUDE_CODE_TEXT;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? (value as string[]) : null;
}

function arrayOr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

interface PendingInputMachine {
  environmentId: string | null;
  label: string;
  conversations: unknown[];
  agents: unknown[];
}

const listPendingInput: OverdeckTool = {
  name: 'list_pending_input',
  description:
    'List what waits on input on this machine and every online linked machine: conversations (questions, permission prompts, plan approvals, menus) and agents (questions, plan approvals, permission requests). A linked conversation is named @<environment-id>/<name>; pass that name to the answer tools. Linked agents carry remote: true and are answered on their own machine.',
  scope: 'read:conversations',
  audience: 'any',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const [local, fleet] = await Promise.all([
      ctx.api.request('GET', '/api/needs-you'),
      ctx.api.request('GET', '/api/fleet/needs-you').catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
    ]);
    if (!isOk(local)) return routeErrorResult(local);
    const localJson = local.json && typeof local.json === 'object' ? (local.json as Record<string, unknown>) : {};
    const machines: PendingInputMachine[] = [
      { environmentId: null, label: 'this machine', conversations: arrayOr(localJson['conversations']), agents: arrayOr(localJson['agents']) },
    ];

    let fleetError: string | undefined;
    if (fleet instanceof Error) {
      fleetError = fleet.message;
    } else if (!isOk(fleet)) {
      const block = routeErrorResult(fleet).content[0];
      fleetError = block && block.type === 'text' ? block.text : 'request failed';
    } else {
      const fleetJson = fleet.json && typeof fleet.json === 'object' ? (fleet.json as Record<string, unknown>) : {};
      for (const entry of arrayOr(fleetJson['machines'])) {
        if (!entry || typeof entry !== 'object') continue;
        const { environmentId, label, conversations, agents } = entry as Record<string, unknown>;
        machines.push({
          environmentId: typeof environmentId === 'string' ? environmentId : null,
          label: typeof label === 'string' ? label : String(environmentId),
          conversations: arrayOr(conversations).map((c) =>
            c && typeof c === 'object' ? { ...c, name: `@${String(environmentId)}/${String((c as Record<string, unknown>)['name'])}` } : c,
          ),
          agents: arrayOr(agents).map((a) =>
            a && typeof a === 'object' ? { ...a, id: `@${String(environmentId)}/${String((a as Record<string, unknown>)['id'])}`, remote: true } : a,
          ),
        });
      }
    }

    return jsonResult({ machines, ...(fleetError ? { fleetError } : {}) });
  },
};

const answerQuestion: OverdeckTool = {
  name: 'answer_question',
  description: 'Answer a pending question: a Claude Code conversation (conversation) or an agent on this machine (agentId). Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: { type: 'string', description: 'The conversation name or id.' },
      agentId: { type: 'string', description: 'The agent id from list_pending_input (this machine only).' },
      toolUseId: { type: 'string', description: 'pendingAskUserQuestion.toolUseId of the agent row; omit to answer its first open question.' },
      answers: { type: 'array', items: { type: 'string' }, description: 'One answer per pending question, in order.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'The question texts, in the same order, quoted in the reply.' },
    },
    required: ['answers'],
  },
  async run(args, ctx) {
    if (!scopeSatisfies(ctx.scopes, 'approve')) return errorResult(MISSING_APPROVE_TEXT);
    const answers = stringArray(args['answers']);
    if (!answers || answers.length === 0) return errorResult('answers is required and must be a non-empty array of strings');

    const hasConversation = typeof args['conversation'] === 'string';
    const hasAgentId = typeof args['agentId'] === 'string';
    if (hasConversation === hasAgentId) return errorResult('pass exactly one of conversation or agentId');

    if (hasAgentId) {
      const agentId = agentIdArg(args);
      if (!agentId.ok) return agentId.error;
      const toolUseId = optionalString(args, 'toolUseId');
      if (!toolUseId.ok) return toolUseId.error;
      const body: Record<string, unknown> = { answers };
      if (toolUseId.value !== undefined) body['toolUseId'] = toolUseId.value;
      return routeResult(await ctx.api.request('POST', `/api/agents/${agentId.value}/answer-question`, body));
    }

    const conversation = requiredString(args, 'conversation');
    if (!conversation.ok) return conversation.error;
    const questions = args['questions'] === undefined ? undefined : stringArray(args['questions']);
    if (questions === null) return errorResult('questions must be an array of strings');

    const name = encodeURIComponent(conversation.value);
    const read = await ctx.api.request('GET', `/api/conversations/${name}`);
    if (!isOk(read)) return routeErrorResult(read);
    const redirect = questionRedirectText(read.json);
    if (redirect) return errorResult(redirect);

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

const answerPaneChoice: OverdeckTool = {
  name: 'answer_pane_choice',
  description: 'Choose an option in a numbered menu shown in a Claude Code conversation (session resume, rate limit and similar). Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
      selectedIndex: { type: 'integer', minimum: 0, maximum: 8, description: '0-based index of the option, from pendingPaneChoice.options.' },
      signature: { type: 'string', description: 'pendingPaneChoice.signature from list_pending_input.' },
    },
    required: ['conversation', 'selectedIndex', 'signature'],
  },
  async run(args, ctx) {
    const path = conversationPath(args, 'pane-choice');
    if (!path.ok) return path.error;
    const selectedIndex = requiredInteger(args, 'selectedIndex', 0, 8);
    if (!selectedIndex.ok) return selectedIndex.error;
    const signature = requiredString(args, 'signature');
    if (!signature.ok) return signature.error;
    return routeResult(await ctx.api.request('POST', path.value, { selectedIndex: selectedIndex.value, signature: signature.value }));
  },
};

const answerCodexApproval: OverdeckTool = {
  name: 'answer_codex_approval',
  description: 'Answer a Codex conversation\'s approval prompt with the 1-based option number shown. Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
      optionNumber: { type: 'integer', minimum: 1, maximum: 9 },
      toolUseId: { type: 'string', description: 'pendingAskUserQuestion.toolUseId from list_pending_input (starts with codex-approval:). Required when Codex runs over its app server.' },
    },
    required: ['conversation', 'optionNumber'],
  },
  async run(args, ctx) {
    const path = conversationPath(args, 'codex-approval');
    if (!path.ok) return path.error;
    const optionNumber = requiredInteger(args, 'optionNumber', 1, 9);
    if (!optionNumber.ok) return optionNumber.error;
    const toolUseId = optionalString(args, 'toolUseId');
    if (!toolUseId.ok) return toolUseId.error;
    const body: Record<string, unknown> = { optionNumber: optionNumber.value };
    if (toolUseId.value !== undefined) body['toolUseId'] = toolUseId.value;
    return routeResult(await ctx.api.request('POST', path.value, body));
  },
};

const answerPiAsk: OverdeckTool = {
  name: 'answer_pi_ask',
  description: 'Answer a Pi conversation\'s ask prompt (one question). Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
      toolUseId: { type: 'string' },
      answers: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1, description: 'Exactly one answer: an option label or free text.' },
    },
    required: ['conversation', 'toolUseId', 'answers'],
  },
  async run(args, ctx) {
    const path = conversationPath(args, 'pi-ask-answer');
    if (!path.ok) return path.error;
    const toolUseId = requiredString(args, 'toolUseId');
    if (!toolUseId.ok) return toolUseId.error;
    const answers = stringArray(args['answers']);
    if (!answers || answers.length !== 1 || !answers[0]?.trim()) return errorResult('answers must contain exactly one non-empty string');
    return routeResult(await ctx.api.request('POST', path.value, { toolUseId: toolUseId.value, answers }));
  },
};

const answerPlan: OverdeckTool = {
  name: 'answer_plan',
  description: 'Approve or reject the plan a conversation proposed: approve-auto, approve-manual, reject-ultraplan or reject-feedback (with feedback). Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      conversation: CONVERSATION_PROPERTY,
      action: { type: 'string', enum: [...PLAN_ACTIONS] },
      feedback: { type: 'string', description: 'What to change; used with reject-feedback.' },
    },
    required: ['conversation', 'action'],
  },
  async run(args, ctx) {
    const path = conversationPath(args, 'plan-action');
    if (!path.ok) return path.error;
    const action = args['action'];
    if (typeof action !== 'string' || !(PLAN_ACTIONS as readonly string[]).includes(action)) {
      return errorResult(`action must be one of ${PLAN_ACTIONS.join(', ')}`);
    }
    const feedback = optionalString(args, 'feedback');
    if (!feedback.ok) return feedback.error;
    const body: Record<string, unknown> = { action };
    if (feedback.value !== undefined) body['feedback'] = feedback.value;
    return routeResult(await ctx.api.request('POST', path.value, body));
  },
};

const answerAgentPlan: OverdeckTool = {
  name: 'answer_agent_plan',
  description: 'Approve or reject a plan an agent on this machine is waiting on. Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'The agent id from list_pending_input (this machine only).' },
      action: { type: 'string', enum: [...PLAN_ACTIONS] },
      feedback: { type: 'string', description: 'What to change; used with reject-feedback.' },
    },
    required: ['agentId', 'action'],
  },
  async run(args, ctx) {
    const agentId = agentIdArg(args);
    if (!agentId.ok) return agentId.error;
    const action = args['action'];
    if (typeof action !== 'string' || !(PLAN_ACTIONS as readonly string[]).includes(action)) {
      return errorResult(`action must be one of ${PLAN_ACTIONS.join(', ')}`);
    }
    const feedback = optionalString(args, 'feedback');
    if (!feedback.ok) return feedback.error;
    const body: Record<string, unknown> = { action };
    if (feedback.value !== undefined) body['feedback'] = feedback.value;
    return routeResult(await ctx.api.request('POST', `/api/agents/${agentId.value}/plan-action`, body));
  },
};

const answerAgentPermission: OverdeckTool = {
  name: 'answer_agent_permission',
  description: 'Allow or deny a tool-permission request from an agent on this machine. Needs the approve scope.',
  scope: 'approve',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'The agent id from list_pending_input (this machine only).' },
      requestId: { type: 'string', description: 'permissionRequests[].requestId from list_pending_input.' },
      behavior: { type: 'string', enum: ['allow', 'deny'] },
    },
    required: ['agentId', 'requestId', 'behavior'],
  },
  async run(args, ctx) {
    const agentId = agentIdArg(args);
    if (!agentId.ok) return agentId.error;
    const requestId = requiredString(args, 'requestId');
    if (!requestId.ok) return requestId.error;
    const behavior = args['behavior'];
    if (behavior !== 'allow' && behavior !== 'deny') return errorResult('behavior must be allow or deny');
    const path = `/api/agents/${agentId.value}/permissions/${encodeURIComponent(requestId.value)}/respond`;
    return routeResult(await ctx.api.request('POST', path, { behavior }));
  },
};

export const APPROVE_TOOLS: readonly OverdeckTool[] = [
  listPendingInput,
  answerQuestion,
  answerPermission,
  answerPaneChoice,
  answerCodexApproval,
  answerPiAsk,
  answerPlan,
  answerAgentPlan,
  answerAgentPermission,
];
