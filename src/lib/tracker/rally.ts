/**
 * Rally Tracker Adapter
 *
 * Implements IssueTracker interface for Broadcom Rally (formerly CA Agile Central).
 * Supports all Rally work item types: User Stories, Defects, Tasks, and Features.
 */

// @ts-expect-error No type declarations available for 'rally' package
import rally from 'rally';
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
import { IssueNotFoundError, TrackerAuthError, NotImplementedError } from './interface.js';

// Map Rally ScheduleState to normalized IssueState
const STATE_MAP: Record<string, IssueState> = {
  Defined: 'open',
  'In-Progress': 'in_progress',
  Completed: 'closed',
  Accepted: 'closed',
};

// Rally artifact types we support
type RallyArtifactType = 'HierarchicalRequirement' | 'Defect' | 'Task' | 'PortfolioItem/Feature';

// Rally priority strings to numbers
const PRIORITY_MAP: Record<string, number> = {
  'Resolve Immediately': 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

// Reverse priority mapping
const REVERSE_PRIORITY_MAP: Record<number, string> = {
  0: 'Resolve Immediately',
  1: 'High',
  2: 'Normal',
  3: 'Low',
  4: 'Low',
};

export interface RallyConfig {
  apiKey: string;
  server?: string; // Default: rally1.rallydev.com
  workspace?: string; // Rally workspace OID (e.g., "/workspace/12345")
  project?: string; // Rally project OID (e.g., "/project/67890")
}

export class RallyTracker implements IssueTracker {
  readonly name: TrackerType = 'rally' as TrackerType;
  private restApi: any;
  private workspace?: string;
  private project?: string;

  constructor(config: RallyConfig) {
    if (!config.apiKey) {
      throw new TrackerAuthError('rally' as TrackerType, 'API key is required');
    }

    this.restApi = rally({
      apiKey: config.apiKey,
      server: config.server || 'https://rally1.rallydev.com',
      requestOptions: {
        headers: {
          'X-RallyIntegrationType': 'Panopticon',
          'X-RallyIntegrationName': 'Panopticon CLI',
          'X-RallyIntegrationVendor': 'Mind Your Now',
          'X-RallyIntegrationVersion': '0.2.0',
        },
      },
    });

    this.workspace = config.workspace;
    this.project = config.project;
  }

  async listIssues(filters?: IssueFilters): Promise<Issue[]> {
    const query: any = {
      type: 'artifact', // Query all artifact types
      fetch: [
        'FormattedID',
        'Name',
        'Description',
        'ScheduleState',
        'State', // For Defects
        'Tags',
        'Owner',
        'Priority',
        'DueDate',
        'CreationDate',
        'LastUpdateDate',
        'Parent',
        '_type',
      ],
      limit: filters?.limit ?? 50,
      query: this.buildQueryString(filters),
    };

    if (this.workspace) {
      query.workspace = this.workspace;
    }
    if (this.project) {
      query.project = this.project;
      query.projectScopeDown = true;
    }

    try {
      const result = await this.queryRally(query);
      return result.Results.map((artifact: any) => this.normalizeIssue(artifact));
    } catch (error: any) {
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        throw new TrackerAuthError('rally' as TrackerType, 'Invalid API key or insufficient permissions');
      }
      throw error;
    }
  }

  async getIssue(id: string): Promise<Issue> {
    try {
      // Rally FormattedIDs look like: US123, DE456, TA789, F012
      const query: any = {
        type: 'artifact',
        fetch: [
          'FormattedID',
          'Name',
          'Description',
          'ScheduleState',
          'State',
          'Tags',
          'Owner',
          'Priority',
          'DueDate',
          'CreationDate',
          'LastUpdateDate',
          'Parent',
          '_type',
        ],
        query: `(FormattedID = "${id}")`,
      };

      if (this.workspace) {
        query.workspace = this.workspace;
      }

      const result = await this.queryRally(query);

      if (!result.Results || result.Results.length === 0) {
        throw new IssueNotFoundError(id, 'rally' as TrackerType);
      }

      return this.normalizeIssue(result.Results[0]);
    } catch (error: any) {
      if (error instanceof IssueNotFoundError) throw error;
      throw new IssueNotFoundError(id, 'rally' as TrackerType);
    }
  }

  async updateIssue(id: string, update: IssueUpdate): Promise<Issue> {
    const issue = await this.getIssue(id);

    // Get the Rally object reference
    const query: any = {
      type: 'artifact',
      fetch: ['ObjectID', '_ref', '_type'],
      query: `(FormattedID = "${id}")`,
    };

    if (this.workspace) {
      query.workspace = this.workspace;
    }

    const result = await this.queryRally(query);
    if (!result.Results || result.Results.length === 0) {
      throw new IssueNotFoundError(id, 'rally' as TrackerType);
    }

    const artifact = result.Results[0];
    const updatePayload: Record<string, unknown> = {};

    if (update.title !== undefined) {
      updatePayload.Name = update.title;
    }
    if (update.description !== undefined) {
      updatePayload.Description = update.description;
    }
    if (update.state !== undefined) {
      const rallyState = this.reverseMapState(update.state);
      // Use ScheduleState for User Stories and Tasks, State for Defects
      if (artifact._type === 'Defect') {
        updatePayload.State = rallyState;
      } else {
        updatePayload.ScheduleState = rallyState;
      }
    }
    if (update.priority !== undefined) {
      updatePayload.Priority = REVERSE_PRIORITY_MAP[update.priority] || 'Normal';
    }
    if (update.dueDate !== undefined) {
      updatePayload.DueDate = update.dueDate;
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.updateRally(artifact._type.toLowerCase(), artifact._ref, updatePayload);
    }

    return this.getIssue(id);
  }

  async createIssue(newIssue: NewIssue): Promise<Issue> {
    if (!this.project && !newIssue.team) {
      throw new Error('Project is required to create an issue. Set it in config or provide team field.');
    }

    const project = newIssue.team || this.project;

    // Default to HierarchicalRequirement (User Story) for new issues
    const createPayload: Record<string, unknown> = {
      Name: newIssue.title,
      Description: newIssue.description || '',
      Project: project,
    };

    if (newIssue.priority !== undefined) {
      createPayload.Priority = REVERSE_PRIORITY_MAP[newIssue.priority] || 'Normal';
    }
    if (newIssue.dueDate) {
      createPayload.DueDate = newIssue.dueDate;
    }
    if (this.workspace) {
      createPayload.Workspace = this.workspace;
    }

    const result = await this.createRally('hierarchicalrequirement', createPayload);

    // Fetch the created issue to return normalized format
    return this.getIssue(result.Object.FormattedID);
  }

  async getComments(issueId: string): Promise<Comment[]> {
    const issue = await this.getIssue(issueId);

    // Get the Rally object to find its Discussion
    const query: any = {
      type: 'artifact',
      fetch: ['ObjectID', '_ref', 'Discussion'],
      query: `(FormattedID = "${issueId}")`,
    };

    if (this.workspace) {
      query.workspace = this.workspace;
    }

    const result = await this.queryRally(query);
    if (!result.Results || result.Results.length === 0) {
      return [];
    }

    const artifact = result.Results[0];
    if (!artifact.Discussion) {
      return [];
    }

    // Query ConversationPosts for this Discussion
    const postsQuery: any = {
      type: 'conversationpost',
      fetch: ['ObjectID', 'Text', 'User', 'CreationDate', 'PostNumber'],
      query: `(Discussion = "${artifact.Discussion._ref}")`,
      order: 'PostNumber',
    };

    const postsResult = await this.queryRally(postsQuery);

    return (postsResult.Results || []).map((post: any) => ({
      id: post.ObjectID,
      issueId,
      body: post.Text || '',
      author: post.User?._refObjectName || 'Unknown',
      createdAt: post.CreationDate,
      updatedAt: post.CreationDate, // Rally doesn't track comment updates separately
    }));
  }

  async addComment(issueId: string, body: string): Promise<Comment> {
    // Get the Rally object to find its Discussion
    const query: any = {
      type: 'artifact',
      fetch: ['ObjectID', '_ref', 'Discussion'],
      query: `(FormattedID = "${issueId}")`,
    };

    if (this.workspace) {
      query.workspace = this.workspace;
    }

    const result = await this.queryRally(query);
    if (!result.Results || result.Results.length === 0) {
      throw new IssueNotFoundError(issueId, 'rally' as TrackerType);
    }

    const artifact = result.Results[0];

    // If no Discussion exists, create one
    let discussionRef = artifact.Discussion?._ref;
    if (!discussionRef) {
      const discussionResult = await this.createRally('conversationpost', {
        Artifact: artifact._ref,
        Text: body,
      });

      return {
        id: discussionResult.Object.ObjectID,
        issueId,
        body,
        author: 'Panopticon',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Add a post to existing Discussion
    const postResult = await this.createRally('conversationpost', {
      Artifact: artifact._ref,
      Text: body,
    });

    return {
      id: postResult.Object.ObjectID,
      issueId,
      body,
      author: 'Panopticon',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async transitionIssue(id: string, state: IssueState): Promise<void> {
    await this.updateIssue(id, { state });
  }

  async linkPR(issueId: string, prUrl: string): Promise<void> {
    // Add a comment with the PR link
    await this.addComment(issueId, `Linked Pull Request: ${prUrl}`);
  }

  // Private helper methods

  private buildQueryString(filters?: IssueFilters): string {
    const conditions: string[] = [];

    if (filters?.state && !filters.includeClosed) {
      const rallyState = this.reverseMapState(filters.state);
      conditions.push(`((ScheduleState = "${rallyState}") OR (State = "${rallyState}"))`);
    }

    if (!filters?.includeClosed) {
      // Exclude completed/accepted items by default
      conditions.push('((ScheduleState != "Completed") AND (ScheduleState != "Accepted") AND (State != "Closed"))');
    }

    if (filters?.assignee) {
      conditions.push(`(Owner.Name contains "${filters.assignee}")`);
    }

    if (filters?.labels && filters.labels.length > 0) {
      const labelConditions = filters.labels.map(
        (label) => `(Tags.Name contains "${label}")`
      );
      conditions.push(`(${labelConditions.join(' AND ')})`);
    }

    if (filters?.query) {
      conditions.push(`((Name contains "${filters.query}") OR (Description contains "${filters.query}"))`);
    }

    return conditions.length > 0 ? conditions.join(' AND ') : '';
  }

  private normalizeIssue(rallyArtifact: any): Issue {
    // Determine state from ScheduleState (User Stories, Tasks) or State (Defects)
    const stateValue = rallyArtifact.ScheduleState || rallyArtifact.State || 'Defined';
    const state = this.mapState(stateValue);

    // Extract tags
    const labels: string[] = [];
    if (rallyArtifact.Tags && rallyArtifact.Tags._tagsNameArray) {
      labels.push(...rallyArtifact.Tags._tagsNameArray);
    }

    // Map priority
    const priority = rallyArtifact.Priority
      ? PRIORITY_MAP[rallyArtifact.Priority] ?? 2
      : undefined;

    // Build URL - Rally's web UI uses FormattedID
    const baseUrl = this.restApi.server.replace('/slm/webservice/', '');
    const url = `${baseUrl}/#/detail/${rallyArtifact._type.toLowerCase()}/${rallyArtifact.ObjectID}`;

    return {
      id: rallyArtifact.ObjectID,
      ref: rallyArtifact.FormattedID,
      title: rallyArtifact.Name || '',
      description: rallyArtifact.Description || '',
      state,
      labels,
      assignee: rallyArtifact.Owner?._refObjectName,
      url,
      tracker: 'rally' as TrackerType,
      priority,
      dueDate: rallyArtifact.DueDate,
      createdAt: rallyArtifact.CreationDate,
      updatedAt: rallyArtifact.LastUpdateDate,
    };
  }

  private mapState(rallyState: string): IssueState {
    return STATE_MAP[rallyState] ?? 'open';
  }

  private reverseMapState(state: IssueState): string {
    switch (state) {
      case 'open':
        return 'Defined';
      case 'in_progress':
        return 'In-Progress';
      case 'closed':
        return 'Completed';
      default:
        return 'Defined';
    }
  }

  // Rally API wrapper methods
  private queryRally(queryConfig: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.restApi.query(queryConfig, (error: any, result: any) => {
        if (error) {
          reject(new Error(error.message || 'Rally API query failed'));
        } else {
          resolve(result);
        }
      });
    });
  }

  private createRally(type: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.restApi.create({
        type,
        data,
        fetch: ['FormattedID', 'ObjectID', '_ref'],
      }, (error: any, result: any) => {
        if (error) {
          reject(new Error(error.message || 'Rally API create failed'));
        } else {
          resolve(result);
        }
      });
    });
  }

  private updateRally(type: string, ref: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.restApi.update({
        type,
        ref,
        data,
        fetch: ['FormattedID', 'ObjectID'],
      }, (error: any, result: any) => {
        if (error) {
          reject(new Error(error.message || 'Rally API update failed'));
        } else {
          resolve(result);
        }
      });
    });
  }
}
