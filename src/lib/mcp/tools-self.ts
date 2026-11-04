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

import { errorResult, type McpToolContext, type OverdeckTool, requiredString, routeResult, WAIT_CHUNK_MS } from './tool.js';

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

export const SELF_TOOLS: readonly OverdeckTool[] = [waitJob, taskClaim, taskDone, taskBlock];
