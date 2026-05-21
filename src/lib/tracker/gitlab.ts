/**
 * GitLab Issues Tracker Adapter (Stub)
 *
 * Placeholder implementation for GitLab Issues support.
 * Full implementation will use @gitbeaker/rest.
 */

import { Effect } from 'effect';
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

const notImplemented = (feature: string) =>
  Effect.fail(new NotImplementedError({ feature }));

export class GitLabTracker implements IssueTracker {
  readonly name: TrackerType = 'gitlab';

  constructor(
    private token: string,
    private projectId: string,
  ) {
    // Stub - will initialize @gitbeaker client when implemented
    void this.token;
    void this.projectId;
  }

  listIssues(
    _filters?: IssueFilters,
  ): Effect.Effect<Issue[], NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  getIssue(_id: string): Effect.Effect<Issue, NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  updateIssue(
    _id: string,
    _update: IssueUpdate,
  ): Effect.Effect<Issue, NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  createIssue(_issue: NewIssue): Effect.Effect<Issue, NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  getComments(
    _issueId: string,
  ): Effect.Effect<Comment[], NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  addComment(
    _issueId: string,
    _body: string,
  ): Effect.Effect<Comment, NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  transitionIssue(
    _id: string,
    _state: IssueState,
  ): Effect.Effect<void, NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  linkPR(
    _issueId: string,
    _prUrl: string,
  ): Effect.Effect<void, NotImplementedError> {
    return notImplemented('GitLab tracker is not yet implemented. Coming soon!');
  }

  getChildIssues(_parentId: string): Effect.Effect<Issue[], never> {
    // GitLab tracker is not yet implemented
    return Effect.succeed([]);
  }
}
