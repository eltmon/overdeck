/**
 * Rally Tracker Adapter
 *
 * Implements IssueTracker interface for Broadcom Rally (formerly CA Agile Central).
 * Supports all Rally work item types: User Stories, Defects, Tasks, and Features.
 */

import { RallyRestApi } from './rally-api.js';
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

// Map Rally ScheduleState/State to normalized IssueState.
// Covers all standard states for User Stories, Defects, Tasks, and Features.
const STATE_MAP: Record<string, IssueState> = {
  // User Stories (ScheduleState)
  'New': 'open',
  'Idea': 'open',
  'Defined': 'open',
  'In-Progress': 'in_progress',
  'Completed': 'closed',
  'Accepted': 'closed',

  // Defects (State)
  'Submitted': 'open',
  'Open': 'in_progress',       // "Open" defects are actively being worked
  'Fixed': 'closed',
  'Closed': 'closed',

  // Features / PortfolioItems (State)
  'Discovering': 'open',
  'Developing': 'in_progress',
  'Done': 'closed',
};

// Rally artifact types we support
type RallyArtifactType = 'HierarchicalRequirement' | 'Defect' | 'Task' | 'PortfolioItem/Feature';

/**
 * Type-specific query configuration.
 *
 * Rally WSAPI cannot filter generic Artifact by ScheduleState because not all
 * subtypes have that field. Instead, we query each type separately with its
 * own state field and merge the results. (PAN-168)
 */
interface ArtifactTypeQuery {
  /** WSAPI endpoint type (lowercase) */
  type: string;
  /** The state field used for filtering on this artifact type */
  stateField: 'ScheduleState' | 'State';
  /** State values that represent "closed" for this type */
  closedStates: string[];
}

const QUERYABLE_TYPES: ArtifactTypeQuery[] = [
  { type: 'hierarchicalrequirement', stateField: 'ScheduleState', closedStates: ['Completed', 'Accepted'] },
  { type: 'defect', stateField: 'State', closedStates: ['Closed'] },
  { type: 'task', stateField: 'State', closedStates: ['Completed'] },
  { type: 'portfolioitem/feature', stateField: 'State', closedStates: ['Done'] },
];

const FETCH_FIELDS = [
  'ObjectID',
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
  'PortfolioItem',
  '_type',
];

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
  private restApi: RallyRestApi;
  private workspace?: string;
  private project?: string;

  constructor(config: RallyConfig) {
    if (!config.apiKey) {
      throw new TrackerAuthError('rally' as TrackerType, 'API key is required');
    }

    this.restApi = new RallyRestApi({
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

  /**
   * List issues by querying each artifact type separately and merging results.
   *
   * Rally WSAPI cannot apply ScheduleState filters across the generic Artifact
   * endpoint because not all subtypes have that field. We query each type with
   * its own state field, then merge and sort. (PAN-168)
   */
  async listIssues(filters?: IssueFilters): Promise<Issue[]> {
    if (process.env.DEBUG?.includes('rally')) {
      console.debug('[Rally] Query filters:', JSON.stringify(filters));
    }

    const limit = filters?.limit ?? 50;

    // Extract ObjectID from project ref for explicit query scoping
    // e.g., "/project/822404704163" → "822404704163"
    let projectObjectId: string | undefined;
    if (this.project) {
      const match = this.project.match(/\/project\/(\d+)/);
      if (match) projectObjectId = match[1];
    }

    const queries = QUERYABLE_TYPES.map(async (artifactType) => {
      const queryString = this.buildQueryStringForType(filters, artifactType, projectObjectId);

      if (process.env.DEBUG?.includes('rally')) {
        console.debug(`[Rally] ${artifactType.type} query:`, queryString);
      }

      const query: any = {
        type: artifactType.type,
        fetch: FETCH_FIELDS,
        limit,
        query: queryString,
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
        // Log and skip individual type failures so other types still return
        if (process.env.DEBUG?.includes('rally')) {
          console.debug(`[Rally] Failed to query ${artifactType.type}:`, error.message);
        }
        return [];
      }
    });

    const results = await Promise.all(queries);
    const allIssues = results.flat();

    // Sort by most recently updated first, then apply overall limit
    allIssues.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return allIssues.slice(0, limit);
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
      const artifactType = (artifact._type || '').toLowerCase();
      const kind = artifactType.startsWith('portfolioitem') ? 'feature'
        : artifactType === 'defect' ? 'defect' : 'story';
      const rallyState = this.reverseMapState(update.state, kind);
      if (kind === 'story') {
        updatePayload.ScheduleState = rallyState;
      } else {
        updatePayload.State = rallyState;
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

  async getChildIssues(parentId: string): Promise<Issue[]> {
    // Query Rally for HierarchicalRequirement and Defect artifacts
    // whose PortfolioItem matches the given feature FormattedID.
    const childTypes = [
      { type: 'hierarchicalrequirement', stateField: 'ScheduleState' },
      { type: 'defect', stateField: 'State' },
    ];

    const queries = childTypes.map(async (childType) => {
      const query: any = {
        type: childType.type,
        fetch: FETCH_FIELDS,
        query: `(PortfolioItem.FormattedID = "${parentId}")`,
        limit: 200,
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
        if (process.env.DEBUG?.includes('rally')) {
          console.debug(`[Rally] Failed to query ${childType.type} children:`, error.message);
        }
        return [];
      }
    });

    const results = await Promise.all(queries);
    const allChildren = results.flat();

    // Sort by FormattedID for stable ordering
    allChildren.sort((a, b) => a.ref.localeCompare(b.ref));

    return allChildren;
  }

  // Private helper methods

  /**
   * Build a Rally WSAPI query string for a specific artifact type.
   *
   * Each artifact type has its own state field:
   *   - HierarchicalRequirement: ScheduleState (Defined, In-Progress, Completed, Accepted)
   *   - Defect: State (Submitted, Open, Fixed, Closed)
   *   - Task: State (Defined, In-Progress, Completed)
   *
   * Rally WSAPI v2.0 requires binary-nested AND/OR with outer parentheses.
   * (PAN-166, PAN-168)
   */
  private buildQueryStringForType(
    filters: IssueFilters | undefined,
    artifactType: ArtifactTypeQuery,
    projectObjectId?: string,
  ): string {
    const conditions: string[] = [];

    // Explicit project scoping — more reliable than WSAPI project param alone
    if (projectObjectId) {
      conditions.push(`(Project.ObjectID = "${projectObjectId}")`);
    }

    if (filters?.state && !filters.includeClosed) {
      const kind = artifactType.type.startsWith('portfolioitem') ? 'feature'
        : artifactType.type === 'defect' ? 'defect' : 'story';
      const rallyState = this.reverseMapState(filters.state, kind);
      conditions.push(`(${artifactType.stateField} = "${rallyState}")`);
    }

    if (!filters?.includeClosed) {
      // Exclude closed states for this specific artifact type
      const closedConditions = artifactType.closedStates.map(
        (state) => `(${artifactType.stateField} != "${state}")`
      );
      // Rally WSAPI only supports binary AND — nest into pairs
      const closedExpr = closedConditions.reduce(
        (acc, cond) => (acc ? `(${acc} AND ${cond})` : cond),
        '',
      );
      conditions.push(closedExpr);
    }

    if (filters?.assignee) {
      conditions.push(`(Owner.Name contains "${filters.assignee}")`);
    }

    if (filters?.labels && filters.labels.length > 0) {
      const labelConditions = filters.labels.map(
        (label) => `(Tags.Name contains "${label}")`
      );
      // Rally WSAPI only supports binary AND — nest into pairs
      const labelExpr = labelConditions.reduce((acc, cond) => acc ? `(${acc} AND ${cond})` : cond, '');
      conditions.push(labelExpr);
    }

    if (filters?.query) {
      conditions.push(`((Name contains "${filters.query}") OR (Description contains "${filters.query}"))`);
    }

    // Rally WSAPI only supports binary (expr AND expr) — reduce into nested pairs
    return conditions.reduce((acc, cond) => acc ? `(${acc} AND ${cond})` : cond, '');
  }

  private normalizeIssue(rallyArtifact: any): Issue {
    // Determine state from ScheduleState (User Stories, Tasks) or State (Defects, Features)
    // For PortfolioItem/Feature, State is a Rally ref object with Name/_refObjectName, not a string
    const rawStateValue = rallyArtifact.ScheduleState || rallyArtifact.State || 'Defined';
    const stateValue = typeof rawStateValue === 'object' && rawStateValue !== null
      ? (rawStateValue.Name || rawStateValue._refObjectName || 'Defined')
      : rawStateValue;
    const state = this.mapState(stateValue);

    // Extract tags — ensure all entries are strings
    const labels: string[] = [];
    if (rallyArtifact.Tags && rallyArtifact.Tags._tagsNameArray) {
      for (const tag of rallyArtifact.Tags._tagsNameArray) {
        if (typeof tag === 'string') {
          labels.push(tag);
        } else if (tag?.Name) {
          labels.push(tag.Name);
        }
      }
    }

    // Map priority
    const priority = rallyArtifact.Priority
      ? PRIORITY_MAP[rallyArtifact.Priority] ?? 2
      : undefined;

    // Use ObjectID if available, fall back to FormattedID
    const objectId = rallyArtifact.ObjectID || rallyArtifact.FormattedID;
    const artifactType = rallyArtifact._type || 'artifact';

    // Build URL - Rally's web UI detail path
    const baseUrl = this.restApi.server.replace('/slm/webservice/', '');
    const url = `${baseUrl}/#/detail/${artifactType.toLowerCase()}/${objectId}`;

    // Resolve parent reference.
    // For User Stories, PortfolioItem links to the parent Feature (F-prefixed),
    // while Parent links to a parent Story in the hierarchy. Prefer PortfolioItem
    // so that stories are correctly grouped under their Feature. (PAN-202)
    let parentRef: string | undefined;
    if (rallyArtifact.PortfolioItem) {
      if (rallyArtifact.PortfolioItem.FormattedID) {
        parentRef = rallyArtifact.PortfolioItem.FormattedID;
      } else if (rallyArtifact.PortfolioItem._refObjectName) {
        parentRef = rallyArtifact.PortfolioItem._refObjectName;
      }
    } else if (rallyArtifact.Parent) {
      if (rallyArtifact.Parent.FormattedID) {
        parentRef = rallyArtifact.Parent.FormattedID;
      } else if (rallyArtifact.Parent._refObjectName) {
        parentRef = rallyArtifact.Parent._refObjectName;
      }
    }

    return {
      id: String(objectId),
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
      parentRef,
      artifactType,
      rawState: stateValue,
    };
  }

  private mapState(rallyState: string): IssueState {
    return STATE_MAP[rallyState] ?? 'open';
  }

  private reverseMapState(state: IssueState, kind: 'story' | 'defect' | 'feature' = 'story'): string {
    if (kind === 'feature') {
      // Features / PortfolioItems use State: Discovering, Developing, Done
      switch (state) {
        case 'open': return 'Discovering';
        case 'in_progress':
        case 'in_review': return 'Developing';
        case 'closed': return 'Done';
        default: return 'Discovering';
      }
    }
    if (kind === 'defect') {
      // Defects use State: Submitted, Open, Fixed, Closed
      switch (state) {
        case 'open': return 'Submitted';
        case 'in_progress':
        case 'in_review': return 'Open';
        case 'closed': return 'Closed';
        default: return 'Submitted';
      }
    }
    // User Stories / Tasks use ScheduleState: Defined, In-Progress, Completed
    switch (state) {
      case 'open': return 'Defined';
      case 'in_progress':
      case 'in_review': return 'In-Progress';
      case 'closed': return 'Completed';
      default: return 'Defined';
    }
  }

  // Rally API wrapper methods
  private async queryRally(queryConfig: any): Promise<any> {
    const result = await this.restApi.query(queryConfig);
    // Extract Results from WSAPI response format
    return {
      Results: result.QueryResult.Results,
      TotalResultCount: result.QueryResult.TotalResultCount,
    };
  }

  private async createRally(type: string, data: any): Promise<any> {
    const result = await this.restApi.create({
      type,
      data,
      fetch: ['FormattedID', 'ObjectID', '_ref'],
    });
    // Extract Object from WSAPI response format
    return {
      Object: result.CreateResult.Object,
    };
  }

  private async updateRally(type: string, ref: string, data: any): Promise<any> {
    const result = await this.restApi.update({
      type,
      ref,
      data,
      fetch: ['FormattedID', 'ObjectID'],
    });
    // Extract Object from WSAPI response format
    return {
      Object: result.OperationResult.Object,
    };
  }
}
