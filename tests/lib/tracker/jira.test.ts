import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { IssueNotFoundError } from '../../../src/lib/tracker/interface.js';
import { JiraTracker } from '../../../src/lib/tracker/jira.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

interface RecordedRequest {
  method: string;
  url: URL;
  body: unknown;
}

type Handler = (request: RecordedRequest) => Response;

interface Route {
  method: string;
  path: RegExp;
  handler: Handler;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubJira(routes: Route[]) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const route = routes.find(candidate => candidate.method === request.method && candidate.path.test(url.pathname));
    if (!route) return new Response('', { status: 599 });
    return route.handler(request);
  };
  return { fetchImpl, requests };
}

const deployments = [
  {
    deployment: 'cloud' as const,
    site: 'https://acme.atlassian.net',
    version: '3',
    searchPath: /\/rest\/api\/3\/search\/jql$/,
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fix the ', marks: [] }, { type: 'text', text: 'thing', marks: [{ type: 'strong' }] }] }] },
    commentBody: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks ' }, { type: 'text', text: 'good', marks: [{ type: 'em' }] }] }] },
  },
  {
    deployment: 'datacenter' as const,
    site: 'https://jira.example.com',
    version: '2',
    searchPath: /\/rest\/api\/2\/search$/,
    description: 'Fix the *thing*',
    commentBody: 'Looks _good_',
  },
];

describe.each(deployments)('JiraTracker on $deployment', ({ deployment, site, version, searchPath, description, commentBody }) => {
  const rawIssue = (key: string, overrides: Record<string, unknown> = {}) => ({
    id: `id-${key}`,
    key,
    fields: {
      summary: `Summary of ${key}`,
      description,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      labels: ['backend'],
      assignee: { displayName: 'Ada Lovelace' },
      reporter: { displayName: 'Grace Hopper' },
      priority: { name: 'High' },
      parent: { key: 'PROJ-1' },
      issuetype: { name: 'Story' },
      created: '2026-11-01T10:00:00.000+0000',
      updated: '2026-11-02T10:00:00.000+0000',
      duedate: null,
      ...overrides,
    },
  });

  const tracker = (routes: Route[]) => {
    const stub = stubJira(routes);
    const jira = new JiraTracker({
      credentials: { token: fakeToken, email: 'dev@example.com', site },
      projectKey: 'PROJ',
      project: { deployment },
      fetchImpl: stub.fetchImpl,
    });
    return { jira, requests: stub.requests };
  };

  it('lists issues with the project JQL and maps every field', async () => {
    const { jira, requests } = tracker([
      { method: 'GET', path: searchPath, handler: () => json({ issues: [rawIssue('PROJ-7')], isLast: true, total: 1 }) },
    ]);

    const issues = await Effect.runPromise(jira.listIssues());
    expect(requests[0].url.searchParams.get('jql')).toBe('project = "PROJ" AND statusCategory != Done ORDER BY updated DESC');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'id-PROJ-7',
      ref: 'PROJ-7',
      title: 'Summary of PROJ-7',
      description: 'Fix the **thing**',
      state: 'in_progress',
      canonicalState: 'in_progress',
      rawState: 'In Progress',
      labels: ['backend'],
      assignee: 'Ada Lovelace',
      author: 'Grace Hopper',
      priority: 2,
      parentRef: 'PROJ-1',
      artifactType: 'Story',
      url: `${site}/browse/PROJ-7`,
      tracker: 'jira',
    });
  });

  it('escapes JQL string values and adds the filters', async () => {
    const { jira, requests } = tracker([
      { method: 'GET', path: searchPath, handler: () => json({ issues: [], isLast: true, total: 0 }) },
    ]);

    await Effect.runPromise(jira.listIssues({ labels: ['a"b'], assignee: 'me', query: 'say "hi" \\ bye', includeClosed: true }));
    expect(requests[0].url.searchParams.get('jql')).toBe(
      'project = "PROJ" AND labels = "a\\"b" AND assignee = currentUser() AND text ~ "say \\"hi\\" \\\\ bye" ORDER BY updated DESC',
    );
  });

  it('pages through every result up to the limit', async () => {
    const { jira, requests } = tracker([
      {
        method: 'GET',
        path: searchPath,
        handler: ({ url }) => {
          const second = deployment === 'cloud' ? url.searchParams.get('nextPageToken') === 'page-2' : url.searchParams.get('startAt') === '1';
          return second
            ? json({ issues: [rawIssue('PROJ-9')], isLast: true, total: 2 })
            : json({ issues: [rawIssue('PROJ-8')], nextPageToken: 'page-2', isLast: false, total: 2 });
        },
      },
    ]);

    const issues = await Effect.runPromise(jira.listIssues());
    expect(issues.map(issue => issue.ref)).toEqual(['PROJ-8', 'PROJ-9']);
    expect(requests).toHaveLength(2);
    if (deployment === 'cloud') expect(requests[1].url.searchParams.get('nextPageToken')).toBe('page-2');
    else expect(requests[1].url.searchParams.get('startAt')).toBe('1');

    const limited = tracker([
      { method: 'GET', path: searchPath, handler: () => json({ issues: [rawIssue('PROJ-8')], nextPageToken: 'page-2', isLast: false, total: 2 }) },
    ]);
    await expect(Effect.runPromise(limited.jira.listIssues({ limit: 1 }))).resolves.toHaveLength(1);
    expect(limited.requests).toHaveLength(1);
    expect(limited.requests[0].url.searchParams.get('maxResults')).toBe('1');
  });

  it('converts comments to Markdown', async () => {
    const { jira, requests } = tracker([
      {
        method: 'GET',
        path: new RegExp(`/rest/api/${version}/issue/PROJ-7/comment$`),
        handler: () => json({ comments: [{ id: 'c1', body: commentBody, author: { displayName: 'Ada' }, created: '2026-11-03', updated: '2026-11-03' }] }),
      },
    ]);

    const comments = await Effect.runPromise(jira.getComments('PROJ-7'));
    expect(comments).toEqual([{ id: 'c1', issueId: 'PROJ-7', body: 'Looks *good*', author: 'Ada', createdAt: '2026-11-03', updatedAt: '2026-11-03' }]);
    expect(requests[0].url.searchParams.get('orderBy')).toBe('created');
  });

  it('sends comments as ADF on Cloud and wiki markup on Data Center', async () => {
    const { jira, requests } = tracker([
      { method: 'POST', path: new RegExp(`/rest/api/${version}/issue/PROJ-7/comment$`), handler: ({ body }) => json({ id: 'c2', ...(body as object), author: { displayName: 'Bot' }, created: 'now' }) },
    ]);

    const comment = await Effect.runPromise(jira.addComment('PROJ-7', 'Shipped **today**'));
    const sent = (requests[0].body as { body: unknown }).body;
    if (deployment === 'cloud') {
      expect(sent).toEqual({
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shipped ' }, { type: 'text', text: 'today', marks: [{ type: 'strong' }] }] }],
      });
    } else {
      expect(sent).toBe('Shipped *today*');
    }
    expect(comment.body).toBe('Shipped **today**');
  });

  it('posts the transition that reaches the wanted status', async () => {
    const { jira, requests } = tracker([
      { method: 'GET', path: /\/issue\/PROJ-7$/, handler: () => json({ id: '7', key: 'PROJ-7', fields: { status: { name: 'In Progress' } } }) },
      {
        method: 'GET',
        path: /\/issue\/PROJ-7\/transitions$/,
        handler: () => json({ transitions: [
          { id: '21', name: 'Review', to: { name: 'In Review', statusCategory: { key: 'indeterminate' } } },
          { id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done' } } },
        ] }),
      },
      { method: 'POST', path: /\/issue\/PROJ-7\/transitions$/, handler: () => new Response(null, { status: 204 }) },
    ]);

    const outcome = await Effect.runPromise(jira.transitionToCanonical('PROJ-7', 'in_review'));
    expect(outcome.kind).toBe('transitioned');
    const post = requests.find(request => request.method === 'POST');
    expect(post?.url.pathname).toBe(`/rest/api/${version}/issue/PROJ-7/transitions`);
    expect(post?.body).toEqual({ transition: { id: '21' } });
  });

  it('resolves no-transition without a POST when nothing reaches the status', async () => {
    const { jira, requests } = tracker([
      { method: 'GET', path: /\/issue\/PROJ-7$/, handler: () => json({ id: '7', key: 'PROJ-7', fields: { status: { name: 'In Progress' } } }) },
      { method: 'GET', path: /\/issue\/PROJ-7\/transitions$/, handler: () => json({ transitions: [{ id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done' } } }] }) },
    ]);

    const outcome = await Effect.runPromise(jira.transitionToCanonical('PROJ-7', 'in_review'));
    expect(outcome.kind).toBe('no-transition');
    expect(outcome.message).toContain('Finish → Done');
    expect(requests.some(request => request.method === 'POST')).toBe(false);
  });

  it('links a pull request as a remote link keyed by its URL', async () => {
    const prUrl = 'https://github.com/acme/app/pull/42';
    const { jira, requests } = tracker([
      { method: 'POST', path: /\/issue\/PROJ-7\/remotelink$/, handler: () => json({ id: 1 }, 201) },
    ]);

    await Effect.runPromise(jira.linkPR('PROJ-7', prUrl));
    expect(requests[0].body).toEqual({ globalId: prUrl, object: { url: prUrl, title: 'Pull request #42' } });
  });

  it('finds child issues and subtasks', async () => {
    let calls = 0;
    const { jira, requests } = tracker([
      {
        method: 'GET',
        path: searchPath,
        handler: () => {
          calls++;
          if (deployment === 'datacenter' && calls === 1) return new Response('', { status: 400 });
          return json({ issues: [rawIssue('PROJ-2')], isLast: true, total: 1 });
        },
      },
    ]);

    const children = await Effect.runPromise(jira.getChildIssues('PROJ-1'));
    expect(children.map(child => child.ref)).toEqual(['PROJ-2']);
    const jqls = requests.map(request => request.url.searchParams.get('jql'));
    if (deployment === 'cloud') {
      expect(jqls).toEqual(['parent = PROJ-1 ORDER BY created ASC']);
    } else {
      expect(jqls).toEqual(['parent = PROJ-1 OR "Epic Link" = PROJ-1 ORDER BY created ASC', 'parent = PROJ-1 ORDER BY created ASC']);
    }
  });

  it('rejects a malformed key without a request', async () => {
    const { jira, requests } = tracker([]);
    const error = await Effect.runPromise(Effect.flip(jira.getIssue('bad key')));
    expect(error).toBeInstanceOf(IssueNotFoundError);
    expect(requests).toHaveLength(0);
  });
});
