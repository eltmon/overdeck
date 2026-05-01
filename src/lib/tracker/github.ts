/**
 * GitHub Issues Tracker Adapter
 *
 * Implements IssueTracker interface for GitHub Issues.
 */

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

/**
 * Extract issue number from various formats: "300", "#300", "PAN-300"
 */
function parseIssueNumber(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : NaN;
}

export class GitHubTracker implements IssueTracker {
  readonly name: TrackerType = 'github';
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    if (!token) {
      throw new TrackerAuthError('github', 'Token is required');
    }
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required');
    }

    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  async listIssues(filters?: IssueFilters): Promise<Issue[]> {
    const state = this.mapStateToGitHub(filters?.state);

    const response = await this.octokit.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state: filters?.includeClosed ? 'all' : state,
      labels: filters?.labels?.join(',') || undefined,
      assignee: filters?.assignee || undefined,
      per_page: filters?.limit ?? 50,
    });

    // Filter out pull requests (GitHub API returns both)
    const issues = response.data.filter((item) => !item.pull_request);

    return issues.map((issue) => this.normalizeIssue(issue));
  }

  async getIssue(id: string): Promise<Issue> {
    try {
      // Parse the issue number from refs like "#42" or just "42"
      const issueNumber = parseIssueNumber(id);

      if (isNaN(issueNumber)) {
        throw new IssueNotFoundError(id, 'github');
      }

      const { data: issue } = await this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      return this.normalizeIssue(issue);
    } catch (error: any) {
      if (error?.status === 404) {
        throw new IssueNotFoundError(id, 'github');
      }
      throw error;
    }
  }

  async updateIssue(id: string, update: IssueUpdate): Promise<Issue> {
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

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      ...updatePayload,
    });

    return this.getIssue(id);
  }

  async createIssue(newIssue: NewIssue): Promise<Issue> {
    const { data: issue } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: newIssue.title,
      body: newIssue.description,
      labels: newIssue.labels,
      assignees: newIssue.assignee ? [newIssue.assignee] : undefined,
    });

    return this.normalizeIssue(issue);
  }

  async getComments(issueId: string): Promise<Comment[]> {
    const issueNumber = parseIssueNumber(issueId);

    const { data: comments } = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    return comments.map((c) => ({
      id: String(c.id),
      issueId,
      body: c.body ?? '',
      author: c.user?.login ?? 'Unknown',
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  async addComment(issueId: string, body: string): Promise<Comment> {
    const issueNumber = parseIssueNumber(issueId);

    const { data: comment } = await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });

    return {
      id: String(comment.id),
      issueId,
      body: comment.body ?? '',
      author: comment.user?.login ?? 'Unknown',
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    };
  }

  async transitionIssue(id: string, state: IssueState): Promise<void> {
    const issueNumber = parseIssueNumber(id);

    if (state === 'in_progress') {
      // GitHub has no native "in progress" state — use a label instead.
      await this.ensureLabelExists('in-progress', 'In progress', '0075ca');
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels: ['in-progress'],
      });
    } else if (state === 'in_review') {
      // Swap in-progress label for in-review label
      await this.ensureLabelExists('in-review', 'In review', 'e4e669');
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels: ['in-review'],
      });
      // Remove in-progress label if present
      await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name: 'in-progress',
      }).catch(() => {/* label may not exist, ignore */});
    } else {
      // Remove in-progress and in-review labels when moving to open or closed
      const issue = await this.getIssue(id);
      for (const label of ['in-progress', 'in-review']) {
        if (issue.labels?.includes(label)) {
          await this.octokit.issues.removeLabel({
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
            name: label,
          }).catch(() => {/* label may not exist, ignore */});
        }
      }
      await this.updateIssue(id, { state });
    }
  }

  /** Ensure a label exists in the repo, creating it if needed. */
  private async ensureLabelExists(name: string, description: string, color: string): Promise<void> {
    try {
      await this.octokit.issues.getLabel({ owner: this.owner, repo: this.repo, name });
    } catch {
      await this.octokit.issues.createLabel({
        owner: this.owner,
        repo: this.repo,
        name,
        description,
        color,
      }).catch(() => {/* race condition: another process created it first */});
    }
  }

  async linkPR(issueId: string, prUrl: string): Promise<void> {
    // GitHub auto-links PRs that mention issues
    // Add a comment with the PR link
    await this.addComment(
      issueId,
      `Linked Pull Request: ${prUrl}`
    );
  }

  async getChildIssues(_parentId: string): Promise<Issue[]> {
    // GitHub Issues does not support hierarchical parent-child relationships
    return [];
  }

  private normalizeIssue(ghIssue: any): Issue {
    const labels: string[] = ghIssue.labels.map((l: any) =>
      typeof l === 'string' ? l : l.name
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

  private mapStateToGitHub(
    state?: IssueState
  ): 'open' | 'closed' | 'all' {
    if (!state) return 'open';
    if (state === 'closed') return 'closed';
    return 'open'; // Both 'open' and 'in_progress' map to 'open'
  }
}
