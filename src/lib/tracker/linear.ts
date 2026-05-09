/**
 * Linear Issue Tracker Adapter
 *
 * Implements IssueTracker interface for Linear.
 */

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

// Map Linear state types to our normalized states
const STATE_MAP: Record<string, IssueState> = {
  backlog: 'open',
  unstarted: 'open',
  started: 'in_progress',
  completed: 'closed',
  canceled: 'closed',
};

export class LinearTracker implements IssueTracker {
  readonly name: TrackerType = 'linear';
  private client: LinearClient;
  private defaultTeam?: string;

  constructor(apiKey: string, options?: { team?: string }) {
    if (!apiKey) {
      throw new TrackerAuthError('linear', 'API key is required');
    }
    this.client = new LinearClient({ apiKey });
    this.defaultTeam = options?.team;
  }

  async listIssues(filters?: IssueFilters): Promise<Issue[]> {
    const team = filters?.team ?? this.defaultTeam;

    const result = await this.client.issues({
      first: filters?.limit ?? 50,
      filter: {
        team: team ? { key: { eq: team } } : undefined,
        state: filters?.state
          ? { type: { eq: this.reverseMapState(filters.state) } }
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
    });

    const issues: Issue[] = [];
    for (const node of result.nodes) {
      issues.push(await this.normalizeIssue(node));
    }
    return issues;
  }

  async getIssue(id: string): Promise<Issue> {
    try {
      // Check if it's a UUID (36 chars with hyphens)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      if (isUuid) {
        // Fetch directly by UUID
        const issue = await this.client.issue(id);
        if (issue) {
          return this.normalizeIssue(issue);
        }
      } else {
        // Parse identifier (e.g., MIN-630) and search
        const match = id.match(/^([A-Z]+)-(\d+)$/i);
        if (match) {
          const [, teamKey, number] = match;
          // Use searchIssues which supports identifier matching
          const results = await this.client.searchIssues(id, { first: 1 });
          if (results.nodes.length > 0) {
            return this.normalizeIssue(results.nodes[0]);
          }
        }
      }

      throw new IssueNotFoundError(id, 'linear');
    } catch (error) {
      if (error instanceof IssueNotFoundError) throw error;
      throw new IssueNotFoundError(id, 'linear');
    }
  }

  async updateIssue(id: string, update: IssueUpdate): Promise<Issue> {
    const issue = await this.getIssue(id);

    const updatePayload: Record<string, unknown> = {};

    if (update.title !== undefined) {
      updatePayload.title = update.title;
    }
    if (update.description !== undefined) {
      updatePayload.description = update.description;
    }
    if (update.priority !== undefined) {
      updatePayload.priority = update.priority;
    }
    if (update.dueDate !== undefined) {
      updatePayload.dueDate = update.dueDate;
    }
    if (update.state !== undefined) {
      // Need to find the state ID - this is complex in Linear
      // For now, we'll use the transition method
      await this.transitionIssue(id, update.state);
    }
    if (update.labels !== undefined) {
      // Need to look up label IDs - complex operation
      // TODO: Implement label updates
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.client.updateIssue(issue.id, updatePayload);
    }

    return this.getIssue(id);
  }

  async createIssue(newIssue: NewIssue): Promise<Issue> {
    const team = newIssue.team ?? this.defaultTeam;

    if (!team) {
      throw new Error('Team is required to create an issue');
    }

    // Get team ID from key
    const teams = await this.client.teams({
      filter: { key: { eq: team } },
    });

    if (teams.nodes.length === 0) {
      throw new Error(`Team not found: ${team}`);
    }

    const teamId = teams.nodes[0].id;

    const result = await this.client.createIssue({
      teamId,
      title: newIssue.title,
      description: newIssue.description,
      priority: newIssue.priority,
      dueDate: newIssue.dueDate,
    });

    const created = await result.issue;
    if (!created) {
      throw new Error('Failed to create issue');
    }

    return this.normalizeIssue(created);
  }

  async getComments(issueId: string): Promise<Comment[]> {
    const issue = await this.client.issue(issueId);
    const comments = await issue.comments();

    return comments.nodes.map((c) => ({
      id: c.id,
      issueId,
      body: c.body,
      author: c.user?.then((u) => u?.name ?? 'Unknown') as unknown as string, // Simplified
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async addComment(issueId: string, body: string): Promise<Comment> {
    const result = await this.client.createComment({
      issueId,
      body,
    });

    const comment = await result.comment;
    if (!comment) {
      throw new Error('Failed to create comment');
    }

    return {
      id: comment.id,
      issueId,
      body: comment.body,
      author: 'Panopticon', // Simplified
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }

  async transitionIssue(id: string, state: IssueState): Promise<void> {
    // Resolve the Linear issue directly (avoid normalizeIssue which may fail on SDK edge cases)
    let linearIssue: any;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      linearIssue = await this.client.issue(id);
    } else {
      const results = await this.client.searchIssues(id, { first: 1 });
      if (results.nodes.length > 0) {
        linearIssue = results.nodes[0];
      } else {
        throw new IssueNotFoundError(id, 'linear');
      }
    }

    // Get workflow states for the issue's team
    const team = await linearIssue.team;
    if (!team) {
      throw new Error('Could not determine issue team');
    }

    const states = await team.states();

    let targetState: any;
    if (state === 'in_review') {
      // Find a state named "In Review" (case-insensitive) — more precise than matching by type,
      // since "In Progress" and "In Review" are both type "started" in Linear.
      targetState = states.nodes.find((s: any) => s.name.toLowerCase() === 'in review');
      if (!targetState) {
        // Fall back to lowest-position "started" state if no "In Review" state exists
        const startedStates = states.nodes
          .filter((s: any) => s.type === 'started')
          .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
        targetState = startedStates[0];
        if (!targetState) {
          throw new Error('No "In Review" or "started" state found in Linear');
        }
      }
    } else {
      const targetStateType = this.reverseMapState(state);

      // Find a state matching the target type.
      // Multiple states can share the same type (e.g., "In Planning", "In Progress", "In Review"
      // are all type "started"). Prefer the one with the lowest position (most basic/default state
      // for that type), which matches Linear's convention.
      const matchingStates = states.nodes
        .filter((s: any) => s.type === targetStateType)
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
      targetState = matchingStates[0];
      if (!targetState) {
        throw new Error(`No state found matching type: ${targetStateType}`);
      }
    }

    await this.client.updateIssue(linearIssue.id, {
      stateId: targetState.id,
    });
  }

  async linkPR(issueId: string, prUrl: string): Promise<void> {
    const issue = await this.getIssue(issueId);

    await this.client.createAttachment({
      issueId: issue.id,
      title: 'Pull Request',
      url: prUrl,
    });
  }

  async getChildIssues(_parentId: string): Promise<Issue[]> {
    // Linear does not expose parent-child issue hierarchy via its public API
    return [];
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
