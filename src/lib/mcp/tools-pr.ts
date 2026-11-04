/**
 * Pull-request link tool (PAN-4943 W-PR1 WI-7, FR-2 tool half): link a GitHub
 * or GitLab pull/merge request to a conversation, or, for an Overdeck agent
 * with no `conversation` argument, to its own conversation through
 * `POST /api/self/pull-requests` (C-3). The three watch tools (WI-8) join
 * `PR_LINK_TOOLS` in this module.
 */
import { errorResult, requiredString, routeResult, type OverdeckTool } from './tool.js';

function conversationPullRequestsPath(name: string): string {
  return `/api/conversations/${encodeURIComponent(name)}/pull-requests`;
}

const linkPullRequest: OverdeckTool = {
  name: 'link_pull_request',
  description:
    'Link a pull or merge request to a conversation. Pass conversation for any conversation (@<machine>/<name> for one on a linked machine); an Overdeck agent may omit it to link to its own conversation.',
  scope: 'tell',
  audience: 'any',
  inputSchema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'A PR/MR URL, #42, or owner/repo#42.' },
      conversation: { type: 'string', description: 'The conversation name; @<machine>/<name> for one on a linked machine. Omit when an Overdeck agent links to its own conversation.' },
    },
    required: ['ref'],
  },
  async run(args, ctx) {
    const ref = requiredString(args, 'ref');
    if (!ref.ok) return ref.error;
    const conversation = args['conversation'];
    if (conversation !== undefined) {
      if (typeof conversation !== 'string' || !conversation.trim()) return errorResult('conversation must be a non-empty string');
      const body: Record<string, unknown> = { ref: ref.value, ...(ctx.isAgent ? { source: 'agent' } : {}) };
      return routeResult(await ctx.api.request('POST', conversationPullRequestsPath(conversation), body));
    }
    if (!ctx.isAgent) return errorResult('conversation is required unless an Overdeck agent calls this tool');
    return routeResult(await ctx.api.request('POST', '/api/self/pull-requests', { ref: ref.value }));
  },
};

export const PR_LINK_TOOLS: readonly OverdeckTool[] = [linkPullRequest];

const watchPullRequest: OverdeckTool = {
  name: 'watch_pull_request',
  description:
    "Get a message in this conversation when a GitHub pull request's checks fail or pass, its review changes, it gets merge conflicts, or it is merged or closed. Overdeck checks about once a minute; merged or closed ends the watch. Do not poll the PR yourself.",
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'A GitHub pull request URL.' } },
    required: ['url'],
  },
  async run(args, ctx) {
    const url = requiredString(args, 'url');
    if (!url.ok) return url.error;
    return routeResult(await ctx.api.request('POST', '/api/self/pull-request-watches', { url: url.value }));
  },
};

const listPullRequestWatches: OverdeckTool = {
  name: 'list_pull_request_watches',
  description: 'List your own pull request watches.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    return routeResult(await ctx.api.request('GET', '/api/self/pull-request-watches'));
  },
};

const unwatchPullRequest: OverdeckTool = {
  name: 'unwatch_pull_request',
  description: 'Stop watching a pull request you are watching, by its watch id (from watch_pull_request or list_pull_request_watches).',
  scope: 'tell',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The watch id.' } },
    required: ['id'],
  },
  async run(args, ctx) {
    const id = requiredString(args, 'id');
    if (!id.ok) return id.error;
    return routeResult(await ctx.api.request('DELETE', `/api/self/pull-request-watches/${encodeURIComponent(id.value)}`));
  },
};

export const PR_WATCH_TOOLS: readonly OverdeckTool[] = [watchPullRequest, listPullRequestWatches, unwatchPullRequest];
