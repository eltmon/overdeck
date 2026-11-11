/**
 * Jira Tracker Adapter (PAN-5152, FR-1).
 *
 * Implements IssueTracker for Jira Cloud (REST v3, ADF text) and Jira Data
 * Center (REST v2, wiki markup). The Jira project key is the Overdeck
 * project's `issue_prefix`. Status writes go through workflow transitions
 * (`transitionToCanonical`), which succeed with a `no-transition` outcome
 * when no transition reaches the wanted status.
 */

import { Effect } from 'effect';
import type { CanonicalState } from '../../core/state-mapping.js';
import type {
  AnyTrackerError,
  Comment,
  Issue,
  IssueFilters,
  IssueState,
  IssueTracker,
  IssueUpdate,
  NewIssue,
  TrackerType,
} from './interface.js';
import { IssueNotFoundError } from './interface.js';
import { TrackerError } from '../errors.js';
import { JiraRestApi, type JiraDeployment } from './jira-api.js';
import type { JiraCredentials, JiraProjectConfig } from './jira-config.js';
import {
  formatNoTransition,
  jiraStatusMap,
  jiraStatusToCanonical,
  pickJiraTransition,
  type JiraStatusMap,
  type JiraTransition,
  type JiraTransitionOutcome,
  type JiraTransitionTarget,
} from './jira-status.js';
import { adfToMarkdown, markdownToAdf, markdownToWiki, wikiToMarkdown } from './jira-text.js';

export interface JiraTrackerOptions {
  credentials: JiraCredentials;
  /** The Jira project key, which is the Overdeck project's issue_prefix. */
  projectKey: string;
  project?: JiraProjectConfig;
  fetchImpl?: typeof fetch;
}

/** The issue fields every read requests. */
export const JIRA_ISSUE_FIELDS = 'summary,description,status,labels,assignee,reporter,priority,parent,issuetype,created,updated,duedate,subtasks';

const ISSUE_KEY = /^[A-Z][A-Z]{0,9}-\d+$/i;
const DEFAULT_LIMIT = 100;
const PAGE_SIZE = 100;

interface JiraUser {
  displayName?: string;
  accountId?: string;
  name?: string;
}

interface JiraRawIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string; statusCategory?: { key?: string } };
    labels?: string[];
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    priority?: { name?: string } | null;
    parent?: { key?: string } | null;
    issuetype?: { name?: string } | null;
    created?: string;
    updated?: string;
    duedate?: string | null;
  };
}

interface JiraRawComment {
  id: string;
  body?: unknown;
  author?: JiraUser;
  created?: string;
  updated?: string;
}

const PRIORITY_FROM_NAME: Record<string, number> = { highest: 1, high: 2, medium: 3, low: 4, lowest: 4 };
const PRIORITY_TO_NAME: Record<number, string> = { 1: 'Highest', 2: 'High', 3: 'Medium', 4: 'Low' };

/** Map a Jira priority name to Overdeck's 1-4 scale (D-5). Unknown or missing is 3. */
export function jiraPriorityToNumber(name: string | undefined): number {
  return (name && PRIORITY_FROM_NAME[name.trim().toLowerCase()]) || 3;
}

const CANONICAL_TO_ISSUE_STATE: Record<CanonicalState, IssueState> = {
  backlog: 'open',
  todo: 'open',
  in_progress: 'in_progress',
  in_review: 'in_review',
  verifying_on_main: 'in_review',
  done: 'closed',
  canceled: 'closed',
};

const ISSUE_STATE_TO_TARGET: Record<IssueState, JiraTransitionTarget> = {
  open: 'todo',
  in_progress: 'in_progress',
  in_review: 'in_review',
  closed: 'done',
};

/** Escape a JQL string value for use inside double quotes. */
export function escapeJql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class JiraTracker implements IssueTracker {
  readonly name: TrackerType = 'jira';
  readonly projectKey: string;
  private readonly api: JiraRestApi;
  private readonly statusMap: JiraStatusMap;

  constructor(options: JiraTrackerOptions) {
    this.projectKey = options.projectKey.toUpperCase();
    this.statusMap = jiraStatusMap(options.project);
    this.api = new JiraRestApi({
      site: options.project?.site || options.credentials.site,
      token: options.credentials.token,
      email: options.credentials.email,
      deployment: options.project?.deployment,
      fetchImpl: options.fetchImpl,
    });
  }

  /** The normalized site URL this tracker talks to. */
  get site(): string {
    return this.api.site;
  }

  private toMarkdown(body: unknown, deployment: JiraDeployment): string {
    if (body === null || body === undefined) return '';
    if (deployment === 'cloud' || typeof body === 'object') return adfToMarkdown(body);
    return wikiToMarkdown(String(body));
  }

  private fromMarkdown(markdown: string, deployment: JiraDeployment): unknown {
    return deployment === 'cloud' ? markdownToAdf(markdown) : markdownToWiki(markdown);
  }

  private toIssue(raw: JiraRawIssue, deployment: JiraDeployment): Issue {
    const fields = raw.fields ?? {};
    const statusName = fields.status?.name ?? '';
    const canonicalState = jiraStatusToCanonical(statusName, fields.status?.statusCategory?.key, this.statusMap);
    return {
      id: raw.id,
      ref: raw.key,
      title: fields.summary ?? '',
      description: this.toMarkdown(fields.description, deployment),
      state: CANONICAL_TO_ISSUE_STATE[canonicalState],
      canonicalState,
      rawState: statusName,
      labels: fields.labels ?? [],
      assignee: fields.assignee?.displayName,
      author: fields.reporter?.displayName,
      priority: jiraPriorityToNumber(fields.priority?.name),
      dueDate: fields.duedate ?? undefined,
      url: `${this.api.site}/browse/${raw.key}`,
      parentRef: fields.parent?.key,
      artifactType: fields.issuetype?.name,
      createdAt: fields.created ?? '',
      updatedAt: fields.updated ?? fields.created ?? '',
      tracker: 'jira',
    };
  }

  private toComment(issueKey: string, raw: JiraRawComment, deployment: JiraDeployment): Comment {
    return {
      id: raw.id,
      issueId: issueKey,
      body: this.toMarkdown(raw.body, deployment),
      author: raw.author?.displayName ?? 'Unknown',
      createdAt: raw.created ?? '',
      updatedAt: raw.updated ?? raw.created ?? '',
    };
  }

  private issueKey(id: string): Effect.Effect<string, IssueNotFoundError> {
    const key = id.trim().toUpperCase();
    return ISSUE_KEY.test(key) ? Effect.succeed(key) : Effect.fail(new IssueNotFoundError({ id, tracker: 'jira' }));
  }

  /** Run a JQL search, paging until `limit` issues (Cloud: nextPageToken; DC: startAt). */
  private search(jql: string, limit: number): Effect.Effect<Issue[], AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const deployment = yield* self.api.resolveDeployment();
      const raws: JiraRawIssue[] = [];
      if (deployment === 'cloud') {
        let nextPageToken: string | undefined;
        do {
          const params = new URLSearchParams({ jql, fields: JIRA_ISSUE_FIELDS, maxResults: String(Math.min(PAGE_SIZE, limit - raws.length)) });
          if (nextPageToken) params.set('nextPageToken', nextPageToken);
          const page = yield* self.api.api<{ issues?: JiraRawIssue[]; nextPageToken?: string; isLast?: boolean }>('GET', `/search/jql?${params}`);
          raws.push(...(page.issues ?? []));
          nextPageToken = page.isLast === true || (page.issues ?? []).length === 0 ? undefined : page.nextPageToken;
        } while (nextPageToken && raws.length < limit);
      } else {
        let startAt = 0;
        for (;;) {
          const params = new URLSearchParams({ jql, fields: JIRA_ISSUE_FIELDS, startAt: String(startAt), maxResults: String(Math.min(PAGE_SIZE, limit - raws.length)) });
          const page = yield* self.api.api<{ issues?: JiraRawIssue[]; total?: number }>('GET', `/search?${params}`);
          const issues = page.issues ?? [];
          raws.push(...issues);
          startAt += issues.length;
          if (issues.length === 0 || raws.length >= limit || startAt >= (page.total ?? 0)) break;
        }
      }
      return raws.slice(0, limit).map(raw => self.toIssue(raw, deployment));
    });
  }

  listIssues(filters: IssueFilters = {}): Effect.Effect<Issue[], AnyTrackerError> {
    const clauses = [`project = "${escapeJql(this.projectKey)}"`];
    if (filters.state === 'closed') clauses.push('statusCategory = Done');
    else if (filters.state === 'open') clauses.push('statusCategory = "To Do"');
    else if (filters.state) clauses.push('statusCategory = "In Progress"');
    else if (!filters.includeClosed) clauses.push('statusCategory != Done');
    for (const label of filters.labels ?? []) clauses.push(`labels = "${escapeJql(label)}"`);
    if (filters.assignee) {
      clauses.push(filters.assignee === 'me' ? 'assignee = currentUser()' : `assignee = "${escapeJql(filters.assignee)}"`);
    }
    if (filters.query) clauses.push(`text ~ "${escapeJql(filters.query)}"`);
    const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;
    const state = filters.state;
    return this.search(jql, filters.limit ?? DEFAULT_LIMIT).pipe(
      Effect.map(issues => (state ? issues.filter(issue => issue.state === state) : issues)),
    );
  }

  getIssue(id: string): Effect.Effect<Issue, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(id);
      const deployment = yield* self.api.resolveDeployment();
      const raw = yield* self.api.api<JiraRawIssue>('GET', `/issue/${key}?fields=${JIRA_ISSUE_FIELDS}`);
      return self.toIssue(raw, deployment);
    });
  }

  /** Resolve a display name to the assignee field Jira expects (D-4). */
  private assigneeField(name: string, deployment: JiraDeployment): Effect.Effect<{ accountId: string } | { name: string }, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const query = deployment === 'cloud' ? `query=${encodeURIComponent(name)}` : `username=${encodeURIComponent(name)}`;
      const users = yield* self.api.api<JiraUser[]>('GET', `/user/search?${query}`);
      const user = (users ?? [])[0];
      if (deployment === 'cloud' && user?.accountId) return { accountId: user.accountId };
      if (deployment === 'datacenter' && user?.name) return { name: user.name };
      return yield* Effect.fail(new TrackerError({ tracker: 'jira', operation: 'assignee', message: `No Jira user matches "${name}"` }));
    });
  }

  private writeFields(
    update: Pick<IssueUpdate, 'title' | 'description' | 'labels' | 'assignee' | 'priority' | 'dueDate'>,
    deployment: JiraDeployment,
  ): Effect.Effect<Record<string, unknown>, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const fields: Record<string, unknown> = {};
      if (update.title !== undefined) fields.summary = update.title;
      if (update.description !== undefined) fields.description = self.fromMarkdown(update.description, deployment);
      if (update.labels !== undefined) fields.labels = update.labels;
      if (update.priority !== undefined) fields.priority = { name: PRIORITY_TO_NAME[update.priority] ?? 'Medium' };
      if (update.dueDate !== undefined) fields.duedate = update.dueDate;
      if (update.assignee !== undefined) fields.assignee = yield* self.assigneeField(update.assignee, deployment);
      return fields;
    });
  }

  updateIssue(id: string, update: IssueUpdate): Effect.Effect<Issue, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(id);
      const deployment = yield* self.api.resolveDeployment();
      const fields = yield* self.writeFields(update, deployment);
      if (Object.keys(fields).length > 0) yield* self.api.api<void>('PUT', `/issue/${key}`, { fields });
      if (update.state) yield* self.transitionToCanonical(key, ISSUE_STATE_TO_TARGET[update.state]);
      return yield* self.getIssue(key);
    });
  }

  createIssue(issue: NewIssue): Effect.Effect<Issue, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const deployment = yield* self.api.resolveDeployment();
      const fields = yield* self.writeFields(issue, deployment);
      const created = yield* self.api.api<{ id: string; key: string }>('POST', '/issue', {
        fields: { project: { key: self.projectKey }, issuetype: { name: 'Task' }, ...fields },
      });
      return yield* self.getIssue(created.key);
    });
  }

  getComments(issueId: string): Effect.Effect<Comment[], AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(issueId);
      const deployment = yield* self.api.resolveDeployment();
      const page = yield* self.api.api<{ comments?: JiraRawComment[] }>('GET', `/issue/${key}/comment?orderBy=created&maxResults=100`);
      return (page.comments ?? []).map(comment => self.toComment(key, comment, deployment));
    });
  }

  addComment(issueId: string, body: string): Effect.Effect<Comment, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(issueId);
      const deployment = yield* self.api.resolveDeployment();
      const created = yield* self.api.api<JiraRawComment>('POST', `/issue/${key}/comment`, { body: self.fromMarkdown(body, deployment) });
      return self.toComment(key, created, deployment);
    });
  }

  /**
   * Move an issue toward a canonical state through its workflow (D-10, D-12).
   * Network and auth failures fail the Effect; `already` and `no-transition`
   * succeed as outcomes, so a missing transition never fails the caller.
   */
  transitionToCanonical(id: string, target: JiraTransitionTarget): Effect.Effect<JiraTransitionOutcome, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(id);
      if (self.statusMap[target] === undefined) {
        return { kind: 'already', message: `Jira ${key}: no status is mapped for ${target}; nothing to do.` } as const;
      }
      const issue = yield* self.api.api<JiraRawIssue>('GET', `/issue/${key}?fields=status`);
      const current = issue.fields?.status?.name ?? '';
      const { transitions } = yield* self.api.api<{ transitions?: JiraTransition[] }>('GET', `/issue/${key}/transitions`);
      const choice = pickJiraTransition(current, transitions ?? [], target, self.statusMap);
      if (choice.kind === 'already') {
        return { kind: 'already', message: `Jira ${key}: already in "${current}".` } as const;
      }
      if (choice.kind === 'no-transition') {
        return { kind: 'no-transition', message: formatNoTransition(key, choice) } as const;
      }
      yield* self.api.api<void>('POST', `/issue/${key}/transitions`, { transition: { id: choice.id } });
      return { kind: 'transitioned', message: `Jira ${key}: moved from "${current}" to "${choice.toName}".` } as const;
    });
  }

  transitionIssue(id: string, state: IssueState): Effect.Effect<void, AnyTrackerError> {
    return this.transitionToCanonical(id, ISSUE_STATE_TO_TARGET[state]).pipe(Effect.asVoid);
  }

  linkPR(issueId: string, prUrl: string): Effect.Effect<void, AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(issueId);
      const prNumber = /\/pull\/(\d+)/.exec(prUrl)?.[1];
      yield* self.api.api<unknown>('POST', `/issue/${key}/remotelink`, {
        globalId: prUrl,
        object: { url: prUrl, title: `Pull request ${prNumber ? `#${prNumber}` : prUrl}` },
      });
    });
  }

  /** Children of an epic and subtasks of an issue (CP-3). */
  getChildIssues(parentId: string): Effect.Effect<Issue[], AnyTrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const key = yield* self.issueKey(parentId);
      const deployment = yield* self.api.resolveDeployment();
      const order = ' ORDER BY created ASC';
      if (deployment === 'cloud') return yield* self.search(`parent = ${key}${order}`, DEFAULT_LIMIT);
      return yield* self.search(`parent = ${key} OR "Epic Link" = ${key}${order}`, DEFAULT_LIMIT).pipe(
        Effect.catchIf(
          (error): error is TrackerError => error instanceof TrackerError && /: 400$/.test(error.message),
          () => self.search(`parent = ${key}${order}`, DEFAULT_LIMIT),
        ),
      );
    });
  }
}
