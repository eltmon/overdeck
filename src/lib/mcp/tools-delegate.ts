/**
 * Agent-only delegation tools over `/api/self/workers` (PAN-4938, PAN-4927
 * W-DEL1). The route takes the worker's issue and parent from the caller's
 * agent token; the tools never send either.
 */
import { MACHINE_PROPERTY, NEEDS_PROPERTY } from './tools-write.js';
import { type OverdeckTool, requiredString, routeResult } from './tool.js';

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

export const DELEGATE_TOOLS: readonly OverdeckTool[] = [delegateTask];
