/**
 * Order-book MCP tools (PAN-5598): every tool proxies an existing
 * `/api/orders*` route (parent PRD D-21), so the route-scope table judges
 * each call. Reads need `read:state`; writes need `operate` (D-2). Every
 * tool takes an optional `project` (a registered project key), appended to
 * the query string. `audience: 'any'` (D-3): a caller's scope decides, as
 * for `start_issue`.
 */
import {
  type ArgResult,
  errorResult,
  type OverdeckTool,
  optionalInteger,
  optionalString,
  requiredString,
  routeErrorResult,
  routeResult,
} from './tool.js';

const PROJECT_PROPERTY = {
  type: 'string',
  description: 'The registered project key. Omit it and the dashboard uses its own project, so pass it when you work in another project.',
} as const;
const BOOK_PROPERTY = { type: 'string', description: 'The order book id.' } as const;
const ISSUE_PROPERTY = { type: 'string', description: 'The issue id.' } as const;
const LANE_PROPERTY = { type: 'string', enum: ['A', 'B'], description: 'Lane A runs in parallel, lane B one at a time.' } as const;
const PREREQS_PROPERTY = { type: 'array', items: { type: 'string' }, description: 'Issue ids that must land first.' } as const;
const RE_VERIFY_PROPERTY = { type: 'boolean', description: 'Re-check the PRD before starting.' } as const;
const PLAN_AT_PICKUP_PROPERTY = { type: 'boolean', description: 'Write the plan when the issue starts.' } as const;

/** Appends `project=<key>` to `path` with `?` or `&`, whichever it needs. */
function withProject(path: string, project: string | undefined): string {
  if (project === undefined) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}project=${encodeURIComponent(project)}`;
}

/** An optional boolean argument; `undefined` when absent. */
function optionalBoolean(args: Record<string, unknown>, field: string): ArgResult<boolean | undefined> {
  const value = args[field];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'boolean') return { ok: false, error: errorResult(`${field} must be a boolean`) };
  return { ok: true, value };
}

/** An optional list-of-strings argument; `undefined` when absent. */
function optionalStringList(args: Record<string, unknown>, field: string): ArgResult<string[] | undefined> {
  const value = args[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return { ok: false, error: errorResult(`${field} must be a list of strings`) };
  }
  return { ok: true, value };
}

/** An optional lane argument (A or B); `undefined` when absent. */
function optionalLane(args: Record<string, unknown>, field = 'lane'): ArgResult<'A' | 'B' | undefined> {
  const value = optionalString(args, field);
  if (!value.ok) return value;
  if (value.value !== undefined && value.value !== 'A' && value.value !== 'B') {
    return { ok: false, error: errorResult(`${field} must be A or B`) };
  }
  return { ok: true, value: value.value as 'A' | 'B' | undefined };
}

const listOrderBooks: OverdeckTool = {
  name: 'list_order_books',
  description: 'List a project\'s order books with their progress and problems.',
  scope: 'read:state',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: { project: PROJECT_PROPERTY },
  },
  async run(args, ctx) {
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    return routeResult(await ctx.api.request('GET', withProject('/api/orders', project.value)));
  },
};

const getOrderBook: OverdeckTool = {
  name: 'get_order_book',
  description: 'Read one order book: its issues, lanes, progress and the problems that block it.',
  scope: 'read:state',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: { book: BOOK_PROPERTY, project: PROJECT_PROPERTY },
    required: ['book'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    return routeResult(await ctx.api.request('GET', withProject(`/api/orders/${encodeURIComponent(book.value)}`, project.value)));
  },
};

const listOrderBookCandidates: OverdeckTool = {
  name: 'list_order_book_candidates',
  description: 'List the top backlog issues that are in no order book.',
  scope: 'read:state',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max candidates to return; default 10.' },
      project: PROJECT_PROPERTY,
    },
  },
  async run(args, ctx) {
    const limit = optionalInteger(args, 'limit', 1, 100, 10);
    if (!limit.ok) return limit.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    return routeResult(await ctx.api.request('GET', withProject(`/api/orders/backlog-candidates?limit=${limit.value}`, project.value)));
  },
};

const previewOrderBookBrief: OverdeckTool = {
  name: 'preview_order_book_brief',
  description: 'Show the brief the Flywheel receives for an order book.',
  scope: 'read:state',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: { book: BOOK_PROPERTY, project: PROJECT_PROPERTY },
    required: ['book'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    return routeResult(await ctx.api.request('GET', withProject(`/api/orders/${encodeURIComponent(book.value)}/preview-brief`, project.value)));
  },
};

const createOrderBook: OverdeckTool = {
  name: 'create_order_book',
  description: 'Create a draft order book. Nothing starts from a draft.',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The order book name.' }, project: PROJECT_PROPERTY },
    required: ['name'],
  },
  async run(args, ctx) {
    const name = requiredString(args, 'name');
    if (!name.ok) return name.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    return routeResult(await ctx.api.request('POST', withProject('/api/orders', project.value), { name: name.value }));
  },
};

const updateOrderBook: OverdeckTool = {
  name: 'update_order_book',
  description: 'Rename an order book, change its parallel limit or extra instructions file, pause or resume pickup, or change its status (ready queues it, draft unqueues it, complete archives it).',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      book: BOOK_PROPERTY,
      name: { type: 'string', description: 'Rename the book.' },
      parallelLimit: { type: 'integer', minimum: 1, maximum: 8, description: 'How many lane A issues run at once.' },
      briefFile: { type: 'string', description: 'A repo-relative .md path added to every issue\'s kickoff brief; empty string clears it.' },
      pickup: { type: 'string', enum: ['open', 'paused'], description: 'Pause or resume new pickup.' },
      pickupReason: { type: 'string', description: 'Why pickup changed.' },
      status: { type: 'string', enum: ['ready', 'draft', 'complete'], description: 'ready queues it, draft unqueues it, complete archives it.' },
      project: PROJECT_PROPERTY,
    },
    required: ['book'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const name = optionalString(args, 'name');
    if (!name.ok) return name.error;
    const parallelLimit = optionalInteger(args, 'parallelLimit', 1, 8, undefined);
    if (!parallelLimit.ok) return parallelLimit.error;
    const briefFile = optionalString(args, 'briefFile');
    if (!briefFile.ok) return briefFile.error;
    const pickup = optionalString(args, 'pickup');
    if (!pickup.ok) return pickup.error;
    if (pickup.value !== undefined && pickup.value !== 'open' && pickup.value !== 'paused') {
      return errorResult('pickup must be open or paused');
    }
    const pickupReason = optionalString(args, 'pickupReason');
    if (!pickupReason.ok) return pickupReason.error;
    const status = optionalString(args, 'status');
    if (!status.ok) return status.error;
    if (status.value !== undefined && status.value !== 'ready' && status.value !== 'draft' && status.value !== 'complete') {
      return errorResult('status must be ready, draft or complete');
    }
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;

    if (name.value === undefined && parallelLimit.value === undefined && briefFile.value === undefined && pickup.value === undefined && status.value === undefined) {
      return errorResult('give at least one of name, parallelLimit, briefFile, pickup or status');
    }

    const body: Record<string, unknown> = {};
    if (name.value !== undefined) body['name'] = name.value;
    const settings: Record<string, unknown> = {};
    if (parallelLimit.value !== undefined) settings['laneAConcurrency'] = parallelLimit.value;
    if (briefFile.value !== undefined) settings['briefOverlay'] = briefFile.value;
    if (pickup.value === 'paused') settings['posture'] = 'drain';
    else if (pickup.value === 'open') settings['posture'] = 'open';
    if (pickupReason.value !== undefined) settings['postureReason'] = pickupReason.value;
    if (Object.keys(settings).length > 0) body['settings'] = settings;
    if (status.value !== undefined) body['status'] = status.value;

    return routeResult(await ctx.api.request('PATCH', withProject(`/api/orders/${encodeURIComponent(book.value)}`, project.value), body));
  },
};

const addOrderBookIssues: OverdeckTool = {
  name: 'add_order_book_issues',
  description: 'Add issues to an order book lane. Lane A runs in parallel, lane B one at a time.',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      book: BOOK_PROPERTY,
      issues: { type: 'array', items: { type: 'string' }, description: 'Issue ids to add.' },
      lane: LANE_PROPERTY,
      prereqs: PREREQS_PROPERTY,
      reVerify: RE_VERIFY_PROPERTY,
      planAtPickup: PLAN_AT_PICKUP_PROPERTY,
      project: PROJECT_PROPERTY,
    },
    required: ['book', 'issues'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const issuesArg = args['issues'];
    if (!Array.isArray(issuesArg) || issuesArg.length === 0 || !issuesArg.every((id) => typeof id === 'string')) {
      return errorResult('issues is required and must be a non-empty list of issue ids');
    }
    const lane = optionalLane(args);
    if (!lane.ok) return lane.error;
    const prereqs = optionalStringList(args, 'prereqs');
    if (!prereqs.ok) return prereqs.error;
    const reVerify = optionalBoolean(args, 'reVerify');
    if (!reVerify.ok) return reVerify.error;
    const planAtPickup = optionalBoolean(args, 'planAtPickup');
    if (!planAtPickup.ok) return planAtPickup.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;

    const items = issuesArg.map((issue) => ({
      issue,
      ...(lane.value !== undefined ? { lane: lane.value } : {}),
      ...(prereqs.value !== undefined ? { prereqs: prereqs.value } : {}),
      ...(reVerify.value !== undefined ? { reVerify: reVerify.value } : {}),
      ...(planAtPickup.value !== undefined ? { planAtPickup: planAtPickup.value } : {}),
    }));
    return routeResult(await ctx.api.request('POST', withProject(`/api/orders/${encodeURIComponent(book.value)}/items`, project.value), { items }));
  },
};

const updateOrderBookIssue: OverdeckTool = {
  name: 'update_order_book_issue',
  description: 'Move an issue within or between lanes, or change what it waits for.',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      book: BOOK_PROPERTY,
      issue: ISSUE_PROPERTY,
      lane: LANE_PROPERTY,
      order: { type: 'integer', minimum: 1, description: '1-based position within the lane.' },
      prereqs: PREREQS_PROPERTY,
      reVerify: RE_VERIFY_PROPERTY,
      planAtPickup: PLAN_AT_PICKUP_PROPERTY,
      project: PROJECT_PROPERTY,
    },
    required: ['book', 'issue'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const issue = requiredString(args, 'issue');
    if (!issue.ok) return issue.error;
    const lane = optionalLane(args);
    if (!lane.ok) return lane.error;
    const order = optionalInteger(args, 'order', 1, 1_000_000, undefined);
    if (!order.ok) return order.error;
    const prereqs = optionalStringList(args, 'prereqs');
    if (!prereqs.ok) return prereqs.error;
    const reVerify = optionalBoolean(args, 'reVerify');
    if (!reVerify.ok) return reVerify.error;
    const planAtPickup = optionalBoolean(args, 'planAtPickup');
    if (!planAtPickup.ok) return planAtPickup.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;

    if (lane.value === undefined && order.value === undefined && prereqs.value === undefined && reVerify.value === undefined && planAtPickup.value === undefined) {
      return errorResult('give at least one of lane, order, prereqs, reVerify or planAtPickup');
    }

    const body: Record<string, unknown> = {};
    if (lane.value !== undefined) body['lane'] = lane.value;
    if (order.value !== undefined) body['order'] = order.value;
    if (prereqs.value !== undefined) body['prereqs'] = prereqs.value;
    if (reVerify.value !== undefined) body['reVerify'] = reVerify.value;
    if (planAtPickup.value !== undefined) body['planAtPickup'] = planAtPickup.value;

    return routeResult(await ctx.api.request('PATCH', withProject(`/api/orders/${encodeURIComponent(book.value)}/items/${encodeURIComponent(issue.value)}`, project.value), body));
  },
};

const removeOrderBookIssue: OverdeckTool = {
  name: 'remove_order_book_issue',
  description: 'Remove an issue from an order book.',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: { book: BOOK_PROPERTY, issue: ISSUE_PROPERTY, project: PROJECT_PROPERTY },
    required: ['book', 'issue'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const issue = requiredString(args, 'issue');
    if (!issue.ok) return issue.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    return routeResult(await ctx.api.request(
      'DELETE',
      withProject(`/api/orders/${encodeURIComponent(book.value)}/items/${encodeURIComponent(issue.value)}`, project.value),
      {},
    ));
  },
};

const startOrderBook: OverdeckTool = {
  name: 'start_order_book',
  description: 'Start the Flywheel on an order book. Refused when the book has blocking problems.',
  scope: 'operate',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: { book: BOOK_PROPERTY, project: PROJECT_PROPERTY },
    required: ['book'],
  },
  async run(args, ctx) {
    const book = requiredString(args, 'book');
    if (!book.ok) return book.error;
    const project = optionalString(args, 'project');
    if (!project.ok) return project.error;
    const response = await ctx.api.request('POST', withProject(`/api/orders/${encodeURIComponent(book.value)}/start`, project.value), {});
    if (response.status === 422) {
      const routeErrorText = routeErrorResult(response).content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      const body = response.json && typeof response.json === 'object' ? (response.json as Record<string, unknown>) : {};
      const findings = Array.isArray(body['findings']) ? (body['findings'] as Array<{ issue: string; message: string }>) : [];
      return errorResult([routeErrorText, ...findings.map((finding) => `BLOCK ${finding.issue} ${finding.message}`)].join('\n'));
    }
    return routeResult(response);
  },
};

export const ORDER_TOOLS: readonly OverdeckTool[] = [
  listOrderBooks,
  getOrderBook,
  listOrderBookCandidates,
  previewOrderBookBrief,
  createOrderBook,
  updateOrderBook,
  addOrderBookIssues,
  updateOrderBookIssue,
  removeOrderBookIssue,
  startOrderBook,
];
