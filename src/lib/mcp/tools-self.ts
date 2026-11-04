/**
 * Agent-only tools over the self routes (PAN-4927 W-SELF1, D-10, D-12).
 * `wait_job` waits on a job a self tool started, in chunks of at most 50 s;
 * the route builds the answer, including `next`, and the tool passes it
 * through. `request_secret` and `secret_wait` (PAN-4941 W-SEC1) ask the
 * operator for a secret through the dashboard and wait for the answer: the
 * value lands in a 0600 file and never passes through a tool argument or
 * result. W-SELF2 and W-MEM1 add their tools to SELF_TOOLS.
 */
import { optionalInteger, type OverdeckTool, requiredString, routeResult, WAIT_CHUNK_MS } from './tool.js';

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

const requestSecret: OverdeckTool = {
  name: 'request_secret',
  description:
    'Ask the operator for a secret (an API key or password). The operator types it into the Overdeck dashboard; the value never passes through this conversation. name is an environment-variable-style name such as OPENAI_API_KEY; prompt (at most 300 characters) says what it is for. Then call next (secret_wait). Never ask for a secret in chat and never put one in a tool argument.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'An environment-variable-style name, for example OPENAI_API_KEY.' },
      prompt: { type: 'string', description: 'What the secret is for, at most 300 characters.' },
      timeoutMs: { type: 'integer', minimum: 60_000, maximum: 3_600_000, description: 'How long the request stays open; default 600000 (10 minutes).' },
    },
    required: ['name', 'prompt'],
  },
  async run(args, ctx) {
    const name = requiredString(args, 'name');
    if (!name.ok) return name.error;
    const prompt = requiredString(args, 'prompt');
    if (!prompt.ok) return prompt.error;
    const timeoutMs = optionalInteger(args, 'timeoutMs', 60_000, 3_600_000, undefined);
    if (!timeoutMs.ok) return timeoutMs.error;
    return routeResult(await ctx.api.request('POST', '/api/self/secret-requests', {
      name: name.value,
      prompt: prompt.value,
      ...(timeoutMs.value ? { timeoutMs: timeoutMs.value } : {}),
    }));
  },
};

const secretWait: OverdeckTool = {
  name: 'secret_wait',
  description:
    'Wait up to 50 s for the operator to answer a request_secret call. Answers status "pending" with next: call next again, never sleep or poll. On "delivered" it answers file, a private 0600 file holding the value: read it in your shell straight into the program that needs it, for example KEY="$(cat <file>)" some-command; never print, echo or cat it to the terminal, and never pass it in a tool argument. "declined" or "expired" means you get no secret. An unknown request (HTTP 404) means the dashboard restarted: call request_secret again.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { requestId: { type: 'string', description: 'The requestId request_secret returned.' } },
    required: ['requestId'],
  },
  async run(args, ctx) {
    const requestId = requiredString(args, 'requestId');
    if (!requestId.ok) return requestId.error;
    return routeResult(await ctx.api.request('GET', `/api/self/secret-requests/${encodeURIComponent(requestId.value)}/wait?timeoutMs=${WAIT_CHUNK_MS}`));
  },
};

export const SELF_TOOLS: readonly OverdeckTool[] = [waitJob, requestSecret, secretWait];
