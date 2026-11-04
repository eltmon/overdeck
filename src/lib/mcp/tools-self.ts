/**
 * Agent-only tools over the self routes (PAN-4927 W-SELF1, D-10, D-12).
 * `wait_job` waits on a job a self tool started, in chunks of at most 50 s;
 * the route builds the answer, including `next`, and the tool passes it
 * through. W-SELF2 adds the workflow tools: task_claim, task_done,
 * task_block, done, handoff, worker_report; each posts to its `/api/self/`
 * route and passes the job answer through. W-MEM1 and W-SEC1 add their
 * tools to SELF_TOOLS.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { errorResult, type McpToolContext, optionalString, type OverdeckTool, requiredString, routeResult, WAIT_CHUNK_MS } from './tool.js';

async function postSelf(ctx: McpToolContext, path: string, body: Record<string, unknown>): Promise<CallToolResult> {
  return routeResult(await ctx.api.request('POST', path, body));
}

const waitJob: OverdeckTool = {
  name: 'wait_job',
  description:
    'Wait up to 50 s for a job another Overdeck tool started. Answers status "done" with exitCode, stdout and stderr, or status "running" with next: call next again. Never sleep or poll. Jobs live in dashboard memory, so a dashboard restart forgets them.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { jobId: { type: 'string', description: 'The jobId a tool returned.' } },
    required: ['jobId'],
  },
  async run(args, ctx) {
    const jobId = requiredString(args, 'jobId');
    if (!jobId.ok) return jobId.error;
    return routeResult(await ctx.api.request('GET', `/api/self/jobs/${encodeURIComponent(jobId.value)}/wait?timeoutMs=${WAIT_CHUNK_MS}`));
  },
};

const taskClaim: OverdeckTool = {
  name: 'task_claim',
  description:
    'Claim a checklist item of your issue before you start it (runs pan task claim). Answers status "done" with exitCode and stdout (the item state as JSON), or status "running" with next: call next. A non-zero exitCode means pan refused; stderr says why.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { itemId: { type: 'string', description: 'The checklist item id to claim.' } },
    required: ['itemId'],
  },
  async run(args, ctx) {
    const itemId = requiredString(args, 'itemId');
    if (!itemId.ok) return itemId.error;
    return postSelf(ctx, '/api/self/tasks/claim', { itemId: itemId.value });
  },
};

const taskDone: OverdeckTool = {
  name: 'task_done',
  description:
    'Mark a checklist item done after its commit, with a body line "Item: <itemId>", is pushed (runs pan task done). Answers status "done" with exitCode and stdout, or status "running" with next: call next. A non-zero exitCode means pan refused; stderr says why.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { itemId: { type: 'string', description: 'The checklist item id to mark done.' } },
    required: ['itemId'],
  },
  async run(args, ctx) {
    const itemId = requiredString(args, 'itemId');
    if (!itemId.ok) return itemId.error;
    return postSelf(ctx, '/api/self/tasks/done', { itemId: itemId.value });
  },
};

const taskBlock: OverdeckTool = {
  name: 'task_block',
  description:
    'Mark a checklist item blocked (runs pan task block). Pass on: the issues or PRs it waits on (PAN-123, #45, owner/repo#45 or a PR URL); Overdeck wakes you when all have merged. Answers like task_claim.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'The checklist item id to block.' },
      on: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Issues or PRs this item waits on.' },
    },
    required: ['itemId'],
  },
  async run(args, ctx) {
    const itemId = requiredString(args, 'itemId');
    if (!itemId.ok) return itemId.error;
    const on = args['on'];
    if (on !== undefined && (!Array.isArray(on) || on.some((value) => typeof value !== 'string'))) {
      return errorResult('on must be a list of strings');
    }
    return postSelf(ctx, '/api/self/tasks/block', { itemId: itemId.value, ...(on !== undefined ? { on } : {}) });
  },
};

const done: OverdeckTool = {
  name: 'done',
  description:
    'Signal that your issue\'s work is complete (runs pan done): commits pending plan files, rebases, pushes, opens or updates the PR, moves the tracker to In Review and starts review. It usually takes longer than 50 s, so expect status "running" and call next. A non-zero exitCode means a completion check failed; stderr says what to fix. Call task_done for every item first.',
  scope: 'operate',
  audience: 'agent',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    return postSelf(ctx, '/api/self/done', {});
  },
};

const handoff: OverdeckTool = {
  name: 'handoff',
  description:
    'Hand your conversation off to a new conversation that continues the work (runs pan handoff self). focus steers the new conversation; keep it short and point at a file for a long brief (at most 10,000 characters). Works from a conversation or a review, test or ship run; a work agent has no conversation and gets exitCode 1. Usually answers status "running": call next.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      focus: { type: 'string', maxLength: 10_000, description: 'What the new conversation should do.' },
      title: { type: 'string', maxLength: 200, description: 'The new conversation\'s name.' },
    },
    required: ['focus'],
  },
  async run(args, ctx) {
    const focus = requiredString(args, 'focus');
    if (!focus.ok) return focus.error;
    const title = optionalString(args, 'title');
    if (!title.ok) return title.error;
    return postSelf(ctx, '/api/self/handoff', { focus: focus.value, ...(title.value !== undefined ? { title: title.value } : {}) });
  },
};

const workerReport: OverdeckTool = {
  name: 'worker_report',
  description:
    'Record your report as a worker, in Markdown, for the agent that started you (runs pan worker report). status: done, blocked or failed. Only worker agents can call it. Answers like task_claim.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['done', 'blocked', 'failed'] },
      report: { type: 'string', description: 'Your report, in Markdown.' },
    },
    required: ['status', 'report'],
  },
  async run(args, ctx) {
    const status = requiredString(args, 'status');
    if (!status.ok) return status.error;
    const report = requiredString(args, 'report');
    if (!report.ok) return report.error;
    return postSelf(ctx, '/api/self/worker-report', { status: status.value, report: report.value });
  },
};

export const SELF_TOOLS: readonly OverdeckTool[] = [waitJob, taskClaim, taskDone, taskBlock, done, handoff, workerReport];
