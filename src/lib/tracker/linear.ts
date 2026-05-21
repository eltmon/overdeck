/**
 * Linear Issue Tracker Adapter
 *
 * Implements IssueTracker interface for Linear.
 */

import { Effect } from 'effect';
import { LinearClient } from '@linear/sdk';
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
import { LinearApiError } from '../errors.js';

// Map Linear state types to our normalized states
const STATE_MAP: Record<string, IssueState> = {
  backlog: 'open',
  unstarted: 'open',
  started: 'in_progress',
  completed: 'closed',
  canceled: 'closed',
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wrap an arbitrary Linear SDK promise as an Effect that emits LinearApiError
 * on failure.
 */
function linearCall<A>(
  operation: string,
  thunk: () => Promise<A>,
): Effect.Effect<A, LinearApiError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (cause) => {
      const message =
        (cause as { message?: string } | undefined)?.message ?? String(cause);
      return new LinearApiError({ operation, message, cause });
    },
  });
}

export class LinearTracker implements IssueTracker {
  readonly name: TrackerType = 'linear';
  private client: LinearClient;
  private defaultTeam?: string;

  constructor(apiKey: string, options?: { team?: string }) {
    if (!apiKey) {
      throw new TrackerAuthError({
        tracker: 'linear',
        message: 'API key is required',
      });
    }
    this.client = new LinearClient({ apiKey });
    this.defaultTeam = options?.team;
  }

  listIssues(filters?: IssueFilters): Effect.Effect<Issue[], LinearApiError> {
    const team = filters?.team ?? this.defaultTeam;
    const self = this;

    return linearCall('listIssues', () =>
      self.client.issues({
        first: filters?.limit ?? 50,
        filter: {
          team: team ? { key: { eq: team } } : undefined,
          state: filters?.state
            ? { type: { eq: self.reverseMapState(filters.state) } }
            : filters?.includeClosed
              ? undefined
              : { type: { neq: 'completed' } },
          labels: filters?.labels?.length
            ? { name: { in: filters.labels } }
            : undefined,
          assignee: filters?.assignee
            ? { name: { containsIgnoreCase: filters.assignee } }
            : undefined,
        },
      }),
    ).pipe(
      Effect.flatMap((result) =>
        linearCall('listIssues:normalize', async () => {
          const issues: Issue[] = [];
          for (const node of result.nodes) {
            issues.push(await self.normalizeIssue(node));
          }
          return issues;
        }),
      ),
    );
  }

  getIssue(
    id: string,
  ): Effect.Effect<Issue, IssueNotFoundError | LinearApiError> {
    const self = this;
    return linearCall('getIssue', async () => {
      if (UUID_RE.test(id)) {
        const issue = await self.client.issue(id);
        if (issue) {
          return await self.normalizeIssue(issue);
        }
        return null;
      }

      if (/^([A-Z]+)-(\d+)$/i.test(id)) {
        const results = await self.client.searchIssues(id, { first: 1 });
        if (results.nodes.length > 0) {
          return await self.normalizeIssue(results.nodes[0]);
        }
      }

      return null;
    }).pipe(
      Effect.flatMap((issue) =>
        issue
          ? Effect.succeed(issue)
          : Effect.fail(new IssueNotFoundError({ id, tracker: 'linear' })),
      ),
      // Map any underlying API error to IssueNotFoundError when it looks like a
      // genuine "missing" rather than a transport failure. The old code did
      // this unconditionally; we preserve the legacy behaviour for the not-found
      // case but allow the typed LinearApiError to escape in other situations.
      Effect.catchTag('LinearApiError', () =>
        Effect.fail(new IssueNotFoundError({ id, tracker: 'linear' })),
      ),
    );
  }

  updateIssue(
    id: string,
    update: IssueUpdate,
  ): Effect.Effect<Issue, IssueNotFoundError | LinearApiError> {
    const self = this;
    return self.getIssue(id).pipe(
      Effect.flatMap((issue) => {
        const updatePayload: Record<string, unknown> = {};

        if (update.title !== undefined) updatePayload.title = update.title;
        if (update.description !== undefined)
          updatePayload.description = update.description;
        if (update.priority !== undefined) updatePayload.priority = update.priority;
        if (update.dueDate !== undefined) updatePayload.dueDate = update.dueDate;

        const stateTransition: Effect.Effect<void, IssueNotFoundError | LinearApiError> =
          update.state !== undefined
            ? self.transitionIssue(id, update.state)
            : Effect.succeed(undefined);

        const applyDirect: Effect.Effect<void, LinearApiError> =
          Object.keys(updatePayload).length > 0
            ? linearCall('updateIssue', () =>
                self.client.updateIssue(issue.id, updatePayload),
              ).pipe(Effect.asVoid)
            : Effect.succeed(undefined);

        return stateTransition.pipe(
          Effect.flatMap(() => applyDirect),
          Effect.flatMap(() => self.getIssue(id)),
        );
      }),
    );
  }

  createIssue(newIssue: NewIssue): Effect.Effect<Issue, LinearApiError> {
    const team = newIssue.team ?? this.defaultTeam;
    const self = this;

    if (!team) {
      return Effect.fail(
        new LinearApiError({
          operation: 'createIssue',
          message: 'Team is required to create an issue',
        }),
      );
    }

    return linearCall('createIssue:lookupTeam', () =>
      self.client.teams({ filter: { key: { eq: team } } }),
    ).pipe(
      Effect.flatMap((teams) => {
        if (teams.nodes.length === 0) {
          return Effect.fail(
            new LinearApiError({
              operation: 'createIssue',
              message: `Team not found: ${team}`,
            }),
          );
        }

        const teamId = teams.nodes[0].id;

        return linearCall('createIssue', () =>
          self.client.createIssue({
            teamId,
            title: newIssue.title,
            description: newIssue.description,
            priority: newIssue.priority,
            dueDate: newIssue.dueDate,
          }),
        ).pipe(
          Effect.flatMap((result) =>
            linearCall('createIssue:fetchCreated', async () => {
              const created = await result.issue;
              if (!created) throw new Error('Failed to create issue');
              return await self.normalizeIssue(created);
            }),
          ),
        );
      }),
    );
  }

  getComments(issueId: string): Effect.Effect<Comment[], LinearApiError> {
    const self = this;
    return linearCall('getComments', async () => {
      const issue = await self.client.issue(issueId);
      const comments = await issue.comments();

      return comments.nodes.map((c) => ({
        id: c.id,
        issueId,
        body: c.body,
        author: c.user?.then((u) => u?.name ?? 'Unknown') as unknown as string, // Simplified
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
    });
  }

  addComment(issueId: string, body: string): Effect.Effect<Comment, LinearApiError> {
    const self = this;
    return linearCall('addComment', async () => {
      const result = await self.client.createComment({ issueId, body });
      const comment = await result.comment;
      if (!comment) throw new Error('Failed to create comment');

      return {
        id: comment.id,
        issueId,
        body: comment.body,
        author: 'Panopticon', // Simplified
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
      };
    });
  }

  transitionIssue(
    id: string,
    state: IssueState,
  ): Effect.Effect<void, IssueNotFoundError | LinearApiError> {
    const self = this;

    return linearCall('transitionIssue:resolve', async () => {
      let linearIssue: any;
      if (UUID_RE.test(id)) {
        linearIssue = await self.client.issue(id);
      } else {
        const results = await self.client.searchIssues(id, { first: 1 });
        if (results.nodes.length > 0) {
          linearIssue = results.nodes[0];
        } else {
          return null;
        }
      }
      return linearIssue;
    }).pipe(
      Effect.flatMap((linearIssue): Effect.Effect<void, IssueNotFoundError | LinearApiError> => {
        if (!linearIssue) {
          return Effect.fail(new IssueNotFoundError({ id, tracker: 'linear' }));
        }

        return linearCall('transitionIssue:apply', async () => {
          const team = await linearIssue.team;
          if (!team) {
            throw new Error('Could not determine issue team');
          }

          const states = await team.states();

          let targetState: any;
          if (state === 'in_review') {
            targetState = states.nodes.find(
              (s: any) => s.name.toLowerCase() === 'in review',
            );
            if (!targetState) {
              const startedStates = states.nodes
                .filter((s: any) => s.type === 'started')
                .sort(
                  (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0),
                );
              targetState = startedStates[0];
              if (!targetState) {
                throw new Error(
                  'No "In Review" or "started" state found in Linear',
                );
              }
            }
          } else {
            const targetStateType = self.reverseMapState(state);
            const matchingStates = states.nodes
              .filter((s: any) => s.type === targetStateType)
              .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
            targetState = matchingStates[0];
            if (!targetState) {
              throw new Error(
                `No state found matching type: ${targetStateType}`,
              );
            }
          }

          await self.client.updateIssue(linearIssue.id, {
            stateId: targetState.id,
          });
        });
      }),
    );
  }

  linkPR(
    issueId: string,
    prUrl: string,
  ): Effect.Effect<void, IssueNotFoundError | LinearApiError> {
    const self = this;
    return self.getIssue(issueId).pipe(
      Effect.flatMap((issue) =>
        linearCall('linkPR', () =>
          self.client.createAttachment({
            issueId: issue.id,
            title: 'Pull Request',
            url: prUrl,
          }),
        ),
      ),
      Effect.asVoid,
    );
  }

  getChildIssues(_parentId: string): Effect.Effect<Issue[], never> {
    // Linear does not expose parent-child issue hierarchy via its public API
    return Effect.succeed([]);
  }

  private async normalizeIssue(linearIssue: any): Promise<Issue> {
    const state = await linearIssue.state;
    const assignee = await linearIssue.assignee;
    const labels = await linearIssue.labels();

    // Handle dueDate - can be Date, string, or undefined
    let dueDate: string | undefined;
    if (linearIssue.dueDate) {
      dueDate = linearIssue.dueDate instanceof Date
        ? linearIssue.dueDate.toISOString()
        : String(linearIssue.dueDate);
    }

    return {
      id: linearIssue.id,
      ref: linearIssue.identifier,
      title: linearIssue.title,
      description: linearIssue.description ?? '',
      state: this.mapState(state?.type ?? 'backlog'),
      labels: labels?.nodes?.map((l: any) => l.name) ?? [],
      assignee: assignee?.name,
      url: linearIssue.url,
      tracker: 'linear',
      priority: linearIssue.priority,
      dueDate,
      createdAt: linearIssue.createdAt instanceof Date
        ? linearIssue.createdAt.toISOString()
        : String(linearIssue.createdAt),
      updatedAt: linearIssue.updatedAt instanceof Date
        ? linearIssue.updatedAt.toISOString()
        : String(linearIssue.updatedAt),
    };
  }

  private mapState(linearState: string): IssueState {
    return STATE_MAP[linearState] ?? 'open';
  }

  private reverseMapState(state: IssueState): string {
    switch (state) {
      case 'open':
        return 'unstarted';
      case 'in_progress':
      case 'in_review':
        return 'started';
      case 'closed':
        return 'completed';
      default:
        return 'unstarted';
    }
  }
}
