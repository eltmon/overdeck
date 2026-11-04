/**
 * Agent-only tools over the self routes (PAN-4927 W-SELF1, D-10, D-12).
 * `wait_job` waits on a job a self tool started, in chunks of at most 50 s;
 * the route builds the answer, including `next`, and the tool passes it
 * through. `request_secret` and `secret_wait` (PAN-4941 W-SEC1) ask the
 * operator for a secret through the dashboard and wait for the answer: the
 * value lands in a 0600 file and never passes through a tool argument or
 * result. W-SELF2 adds its tools to SELF_TOOLS; `memory_add` and
 * `memory_search` (PAN-4940 W-MEM1) run `pan memory add` and `pan memory
 * search --facts` as jobs.
 */
import { errorResult, optionalInteger, optionalString, type OverdeckTool, requiredString, routeResult, WAIT_CHUNK_MS } from './tool.js';

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

const memoryAdd: OverdeckTool = {
  name: 'memory_add',
  description:
    'Record a durable fact in Overdeck memory (runs pan memory add in your checkout). type: feedback (a correction or working agreement), project (a non-obvious project truth), reference (a pointer to something outside the repo) or user (about the operator). description is the one-line index entry, at most 200 characters; body holds the fact, then **Why:** and **How to apply:** lines. store: project (default; your checkout\'s .overdeck/memory/), user (the operator\'s store, default for type user) or machine (this machine only). A project fact is written uncommitted: commit .overdeck/memory/<id>.md with your work, or pan done refuses. Answers status "done" with exitCode and stdout ({ file }), or status "running" with next: call next. A non-zero exitCode means pan refused (an existing id, secret-like text, a home-directory path); stderr says why.',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$', description: 'A short kebab-case id, unique within the store.' },
      type: { type: 'string', enum: ['feedback', 'project', 'reference', 'user'], description: 'The fact type.' },
      description: { type: 'string', maxLength: 200, description: 'One-line index entry, at most 200 characters.' },
      title: { type: 'string', maxLength: 200, description: 'A short title (defaults to the id).' },
      body: { type: 'string', maxLength: 16_384, description: 'The fact body: the rule, then **Why:** and **How to apply:** lines.' },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Optional tags.' },
      store: { type: 'string', enum: ['project', 'user', 'machine'], description: 'Which store to write to.' },
    },
    required: ['id', 'type', 'description'],
  },
  async run(args, ctx) {
    const id = requiredString(args, 'id');
    if (!id.ok) return id.error;
    const type = requiredString(args, 'type');
    if (!type.ok) return type.error;
    const description = requiredString(args, 'description');
    if (!description.ok) return description.error;
    const title = optionalString(args, 'title');
    if (!title.ok) return title.error;
    const body = optionalString(args, 'body');
    if (!body.ok) return body.error;
    const store = optionalString(args, 'store');
    if (!store.ok) return store.error;
    if (args.tags !== undefined && !(Array.isArray(args.tags) && args.tags.every((tag) => typeof tag === 'string'))) {
      return errorResult('tags must be a list of strings');
    }
    const tags = args.tags as string[] | undefined;
    return routeResult(await ctx.api.request('POST', '/api/self/memory/facts', {
      id: id.value,
      type: type.value,
      description: description.value,
      ...(title.value !== undefined ? { title: title.value } : {}),
      ...(body.value !== undefined ? { body: body.value } : {}),
      ...(tags ? { tags } : {}),
      ...(store.value !== undefined ? { store: store.value } : {}),
    }));
  },
};

const memorySearch: OverdeckTool = {
  name: 'memory_search',
  description:
    'Search Overdeck memory (runs pan memory search --facts in your checkout). Returns facts: up to 5 matching curated facts from this checkout\'s store (the one memory_add writes), the operator store and the machine store, each { scope, type, id, title, description, tags, file } with no body; and observations: matching automatically extracted session records from your project, each a short summary without the full narrative. query is the search text, at most 500 characters; limit (default 10, max 20) bounds the observations. Answers status "done" with exitCode and stdout (the { facts, observations } JSON), or status "running" with next: call next.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 500, description: 'Search text, at most 500 characters.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum observations to return; default 10.' },
    },
    required: ['query'],
  },
  async run(args, ctx) {
    const query = requiredString(args, 'query');
    if (!query.ok) return query.error;
    const limit = optionalInteger(args, 'limit', 1, 20, undefined);
    if (!limit.ok) return limit.error;
    return routeResult(await ctx.api.request('POST', '/api/self/memory/search', {
      query: query.value,
      ...(limit.value !== undefined ? { limit: limit.value } : {}),
    }));
  },
};

export const SELF_TOOLS: readonly OverdeckTool[] = [waitJob, requestSecret, secretWait, memoryAdd, memorySearch];
