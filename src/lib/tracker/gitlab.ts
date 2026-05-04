/**
 * GitLab Issues Tracker Adapter (Stub)
 *
 * Placeholder implementation for GitLab Issues support.
 * Full implementation will use @gitbeaker/rest.
 */

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
import { NotImplementedError } from './interface.js';

export class GitLabTracker implements IssueTracker {
  readonly name: TrackerType = 'gitlab';

  constructor(
    private token: string,
    private projectId: string
  ) {
    // Stub - will initialize @gitbeaker client when implemented
  }

  async listIssues(_filters?: IssueFilters): Promise<Issue[]> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async getIssue(_id: string): Promise<Issue> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async updateIssue(_id: string, _update: IssueUpdate): Promise<Issue> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async createIssue(_issue: NewIssue): Promise<Issue> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async getComments(_issueId: string): Promise<Comment[]> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async addComment(_issueId: string, _body: string): Promise<Comment> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async transitionIssue(_id: string, _state: IssueState): Promise<void> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async linkPR(_issueId: string, _prUrl: string): Promise<void> {
    throw new NotImplementedError(
      'GitLab tracker is not yet implemented. Coming soon!'
    );
  }

  async getChildIssues(_parentId: string): Promise<Issue[]> {
    // GitLab tracker is not yet implemented
    return [];
  }
}
