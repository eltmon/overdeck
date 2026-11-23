/**
 * Order-book MCP tools (PAN-5598): every tool proxies an existing
 * `/api/orders*` route (parent PRD D-21), so the route-scope table judges
 * each call. Reads need `read:state`; writes need `operate` (D-2). Every
 * tool takes an optional `project` (a registered project key), appended to
 * the query string. `audience: 'any'` (D-3): a caller's scope decides, as
 * for `start_issue`.
 */
import { type OverdeckTool, optionalInteger, optionalString, requiredString, routeResult } from './tool.js';

const PROJECT_PROPERTY = { type: 'string', description: 'The registered project; default this conversation\'s project.' } as const;
const BOOK_PROPERTY = { type: 'string', description: 'The order book id.' } as const;

/** Appends `project=<key>` to `path` with `?` or `&`, whichever it needs. */
function withProject(path: string, project: string | undefined): string {
  if (project === undefined) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}project=${encodeURIComponent(project)}`;
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

export const ORDER_TOOLS: readonly OverdeckTool[] = [listOrderBooks, getOrderBook, listOrderBookCandidates, previewOrderBookBrief];
