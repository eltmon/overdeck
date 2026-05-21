/**
 * GitHub Issues Tracker Adapter
 *
 * Implements IssueTracker interface for GitHub Issues.
 */

import { Effect } from 'effect';
import { Octokit } from '@octokit/rest';
import type {
  Issue,
  IssueFilters,
  IssueState,
  IssueTracker,
  IssueUpdate,
  NewIssue,
  Comment,
  TrackerType,
} from './interface.js';
import { IssueNotFoundError, TrackerAuthError } from './interface.js';
import { GitHubApiError } from '../errors.js';

/**
 * Extract issue number from various formats: "300", "#300", "PAN-300"
 */
function parseIssueNumber(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : NaN;
}

/**
 * Wrap an Octokit promise in an Effect that emits typed errors.
 *
 * Treats HTTP 404 as IssueNotFoundError; everything else becomes
 * GitHubApiError carrying the status code (or 0 for network failures).
 */
function octokitToEffect<A>(
  operation: string,
  resourceId: string,
  thunk: () => Promise<A>,
): Effect.Effect<A, IssueNotFoundError | GitHubApiError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (cause) => {
      const status = (cause as { status?: number } | undefined)?.status ?? 0;
      if (status === 404) {
        return new IssueNotFoundError({ id: resourceId, tracker: 'github' });
      }
      const message =
        (cause as { message?: string } | undefined)?.message ?? String(cause);
      return new GitHubApiError({ operation, status, message, cause });
    },
  });
}

export class GitHubTracker implements IssueTracker {
  readonly name: TrackerType = 'github';
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    if (!token) {
      throw new TrackerAuthError({
        tracker: 'github',
        message: 'Token is required',
      });
    }
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required');
    }

    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  listIssues(
    filters?: IssueFilters,
  ): Effect.Effect<Issue[], GitHubApiError> {
    const state = this.mapStateToGitHub(filters?.state);

    return Effect.tryPromise({
      try: () =>
        this.octokit.issues.listForRepo({
          owner: this.owner,
          repo: this.repo,
          state: filters?.includeClosed ? 'all' : state,
          labels: filters?.labels?.join(',') || undefined,
          assignee: filters?.assignee || undefined,
          per_page: filters?.limit ?? 50,
        }),
      catch: (cause) => {
        const status = (cause as { status?: number } | undefined)?.status ?? 0;
        const message =
          (cause as { message?: string } | undefined)?.message ?? String(cause);
        return new GitHubApiError({ operation: 'listIssues', status, message, cause });
      },
    }).pipe(
      Effect.map((response) => {
        // Filter out pull requests (GitHub API returns both)
        const issues = response.data.filter((item) => !item.pull_request);
        return issues.map((issue) => this.normalizeIssue(issue));
      }),
    );
  }

  getIssue(
    id: string,
  ): Effect.Effect<Issue, IssueNotFoundError | GitHubApiError> {
    const issueNumber = parseIssueNumber(id);
    if (isNaN(issueNumber)) {
      return Effect.fail(new IssueNotFoundError({ id, tracker: 'github' }));
    }

    return octokitToEffect('getIssue', id, () =>
      this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
    ).pipe(Effect.map(({ data: issue }) => this.normalizeIssue(issue)));
  }

  updateIssue(
    id: string,
    update: IssueUpdate,
  ): Effect.Effect<Issue, IssueNotFoundError | GitHubApiError> {
    const issueNumber = parseIssueNumber(id);

    const updatePayload: Record<string, unknown> = {};

    if (update.title !== undefined) {
      updatePayload.title = update.title;
    }
    if (update.description !== undefined) {
      updatePayload.body = update.description;
    }
    if (update.state !== undefined) {
      updatePayload.state = update.state === 'closed' ? 'closed' : 'open';
    }
    if (update.labels !== undefined) {
      updatePayload.labels = update.labels;
    }
    if (update.assignee !== undefined) {
      updatePayload.assignees = update.assignee ? [update.assignee] : [];
    }

    return octokitToEffect('updateIssue', id, () =>
      this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        ...updatePayload,
      }),
    ).pipe(Effect.flatMap(() => this.getIssue(id)));
  }

  createIssue(
    newIssue: NewIssue,
  ): Effect.Effect<Issue, GitHubApiError> {
    return Effect.tryPromise({
      try: () =>
        this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: newIssue.title,
          body: newIssue.description,
          labels: newIssue.labels,
          assignees: newIssue.assignee ? [newIssue.assignee] : undefined,
        }),
      catch: (cause) => {
        const status = (cause as { status?: number } | undefined)?.status ?? 0;
        const message =
          (cause as { message?: string } | undefined)?.message ?? String(cause);
        return new GitHubApiError({ operation: 'createIssue', status, message, cause });
      },
    }).pipe(Effect.map(({ data: issue }) => this.normalizeIssue(issue)));
  }

  getComments(issueId: string): Effect.Effect<Comment[], GitHubApiError> {
    const issueNumber = parseIssueNumber(issueId);

    return Effect.tryPromise({
      try: () =>
        this.octokit.issues.listComments({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
        }),
      catch: (cause) => {
        const status = (cause as { status?: number } | undefined)?.status ?? 0;
        const message =
          (cause as { message?: string } | undefined)?.message ?? String(cause);
        return new GitHubApiError({ operation: 'getComments', status, message, cause });
      },
    }).pipe(
      Effect.map(({ data: comments }) =>
        comments.map((c) => ({
          id: String(c.id),
          issueId,
          body: c.body ?? '',
          author: c.user?.login ?? 'Unknown',
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        })),
      ),
    );
  }

  addComment(issueId: string, body: string): Effect.Effect<Comment, GitHubApiError> {
    const issueNumber = parseIssueNumber(issueId);

    return Effect.tryPromise({
      try: () =>
        this.octokit.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          body,
        }),
      catch: (cause) => {
        const status = (cause as { status?: number } | undefined)?.status ?? 0;
        const message =
          (cause as { message?: string } | undefined)?.message ?? String(cause);
        return new GitHubApiError({ operation: 'addComment', status, message, cause });
      },
    }).pipe(
      Effect.map(({ data: comment }) => ({
        id: String(comment.id),
        issueId,
        body: comment.body ?? '',
        author: comment.user?.login ?? 'Unknown',
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
      })),
    );
  }

  transitionIssue(
    id: string,
    state: IssueState,
  ): Effect.Effect<void, IssueNotFoundError | GitHubApiError> {
    const issueNumber = parseIssueNumber(id);
    const owner = this.owner;
    const repo = this.repo;
    const octokit = this.octokit;
    const self = this;

    const addLabels = (labels: string[]) =>
      Effect.tryPromise({
        try: () =>
          octokit.issues.addLabels({
            owner,
            repo,
            issue_number: issueNumber,
            labels,
          }),
        catch: (cause) => {
          const status = (cause as { status?: number } | undefined)?.status ?? 0;
          const message =
            (cause as { message?: string } | undefined)?.message ?? String(cause);
          return new GitHubApiError({ operation: 'addLabels', status, message, cause });
        },
      });

    const removeLabelSilent = (name: string) =>
      Effect.tryPromise({
        try: () =>
          octokit.issues.removeLabel({ owner, repo, issue_number: issueNumber, name }),
        catch: () => new GitHubApiError({
          operation: 'removeLabel',
          status: 0,
          message: 'remove failed',
        }),
      }).pipe(Effect.orElseSucceed(() => undefined));

    const ensureLabelExists = (name: string, description: string, color: string) =>
      Effect.tryPromise({
        try: () => octokit.issues.getLabel({ owner, repo, name }),
        catch: () => new GitHubApiError({
          operation: 'getLabel',
          status: 404,
          message: 'label missing',
        }),
      }).pipe(
        Effect.matchEffect({
          onFailure: () =>
            Effect.tryPromise({
              try: () =>
                octokit.issues.createLabel({
                  owner,
                  repo,
                  name,
                  description,
                  color,
                }),
              catch: () => new GitHubApiError({
                operation: 'createLabel',
                status: 0,
                message: 'create failed',
              }),
            }).pipe(Effect.orElseSucceed(() => undefined)),
          onSuccess: () => Effect.succeed(undefined),
        }),
      );

    if (state === 'in_progress') {
      return ensureLabelExists('in-progress', 'In progress', '0075ca').pipe(
        Effect.flatMap(() => addLabels(['in-progress'])),
        Effect.asVoid,
      );
    }

    if (state === 'in_review') {
      return ensureLabelExists('in-review', 'In review', 'e4e669').pipe(
        Effect.flatMap(() => addLabels(['in-review'])),
        Effect.flatMap(() => removeLabelSilent('in-progress')),
        Effect.asVoid,
      );
    }

    return self.getIssue(id).pipe(
      Effect.flatMap((issue) => {
        const labelsToRemove = ['in-progress', 'in-review'].filter((l) =>
          issue.labels?.includes(l),
        );
        return Effect.forEach(labelsToRemove, (label) => removeLabelSilent(label), {
          concurrency: 1,
        }).pipe(Effect.flatMap(() => self.updateIssue(id, { state })));
      }),
      Effect.asVoid,
    );
  }

  linkPR(issueId: string, prUrl: string): Effect.Effect<void, GitHubApiError> {
    // GitHub auto-links PRs that mention issues. Add a comment with the PR link.
    return this.addComment(issueId, `Linked Pull Request: ${prUrl}`).pipe(
      Effect.asVoid,
    );
  }

  getChildIssues(_parentId: string): Effect.Effect<Issue[], never> {
    // GitHub Issues does not support hierarchical parent-child relationships
    return Effect.succeed([]);
  }

  private normalizeIssue(ghIssue: any): Issue {
    const labels: string[] = ghIssue.labels.map((l: any) =>
      typeof l === 'string' ? l : l.name,
    );
    return {
      id: String(ghIssue.id),
      ref: `#${ghIssue.number}`,
      title: ghIssue.title,
      description: ghIssue.body ?? '',
      state: this.mapStateFromGitHub(ghIssue.state, labels),
      labels,
      assignee: ghIssue.assignee?.login,
      url: ghIssue.html_url,
      tracker: 'github',
      priority: undefined, // GitHub doesn't have priority
      dueDate: undefined, // GitHub doesn't have due dates on issues
      createdAt: ghIssue.created_at,
      updatedAt: ghIssue.updated_at,
    };
  }

  private mapStateFromGitHub(ghState: string, labels: string[] = []): IssueState {
    if (ghState === 'closed') return 'closed';
    if (labels.includes('in-progress')) return 'in_progress';
    return 'open';
  }

  private mapStateToGitHub(state?: IssueState): 'open' | 'closed' | 'all' {
    if (!state) return 'open';
    if (state === 'closed') return 'closed';
    return 'open'; // Both 'open' and 'in_progress' map to 'open'
  }
}
