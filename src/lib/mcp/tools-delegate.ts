/**
 * Agent-only delegation tools over `/api/self/workers` (PAN-4938, PAN-4927
 * W-DEL1). The route takes the worker's issue and parent from the caller's
 * agent token; the tools never send either.
 */
import { MACHINE_PROPERTY, NEEDS_PROPERTY } from './tools-write.js';
import { optionalInteger, type OverdeckTool, requiredString, routeResult, WAIT_CHUNK_MS } from './tool.js';

const delegateTask: OverdeckTool = {
  name: 'delegate_task',
  description:
    'Start a worker agent on your issue to do a task in the background, here or on another machine; you are its parent. Then call task_wait with the workerId. For a quick same-harness subtask use your own subagent tool.',
  scope: 'operate',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The worker brief.' },
      harness: { type: 'string', description: 'The agent harness, such as claude-code or codex.' },
      model: { type: 'string', description: 'The model id or alias.' },
      effort: { type: 'string', description: 'Reasoning effort: low, medium, high, xhigh or max.' },
      readOnly: { type: 'boolean', description: 'Run in the issue workspace behind a read-only git guard.' },
      machine: MACHINE_PROPERTY,
      needs: NEEDS_PROPERTY,
      name: { type: 'string', description: 'A label for the worker.' },
    },
    required: ['task'],
  },
  async run(args, ctx) {
    const task = requiredString(args, 'task');
    if (!task.ok) return task.error;
    return routeResult(await ctx.api.request('POST', '/api/self/workers', args));
  },
};

const taskWait: OverdeckTool = {
  name: 'task_wait',
  description:
    'Wait up to 50 s for one of your workers to report. Answers done with the report, ended when it stopped without one, or running with next: call next again. Never sleep or poll. Pass afterSeq (the seq you consumed) for its next report.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      workerId: { type: 'string', description: 'The workerId delegate_task returned.' },
      afterSeq: { type: 'integer', minimum: 0, description: 'The seq of the last report you consumed; omit for the newest report.' },
    },
    required: ['workerId'],
  },
  async run(args, ctx) {
    const workerId = requiredString(args, 'workerId');
    if (!workerId.ok) return workerId.error;
    const afterSeq = optionalInteger(args, 'afterSeq', 0, 999_999_999, undefined);
    if (!afterSeq.ok) return afterSeq.error;
    const query = `timeoutMs=${WAIT_CHUNK_MS}${afterSeq.value !== undefined ? `&afterSeq=${afterSeq.value}` : ''}`;
    return routeResult(await ctx.api.request('GET', `/api/self/workers/${encodeURIComponent(workerId.value)}/wait?${query}`));
  },
};

const listWorkers: OverdeckTool = {
  name: 'list_workers',
  description: 'List your workers, on this machine or another, with their state, idle time and newest report (seq, time and status).',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    return routeResult(await ctx.api.request('GET', '/api/self/workers'));
  },
};

const taskStatus: OverdeckTool = {
  name: 'task_status',
  description: 'One of your workers: its state, idle time, where it runs and its newest report (seq, time and status). Read the report itself with task_wait.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { workerId: { type: 'string', description: 'The workerId delegate_task returned.' } },
    required: ['workerId'],
  },
  async run(args, ctx) {
    const workerId = requiredString(args, 'workerId');
    if (!workerId.ok) return workerId.error;
    return routeResult(await ctx.api.request('GET', `/api/self/workers/${encodeURIComponent(workerId.value)}`));
  },
};

export const DELEGATE_TOOLS: readonly OverdeckTool[] = [delegateTask, taskWait, listWorkers, taskStatus];
