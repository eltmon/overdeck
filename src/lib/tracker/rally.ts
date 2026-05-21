/**
 * Rally Tracker Adapter
 *
 * Implements IssueTracker interface for Broadcom Rally (formerly CA Agile Central).
 * Supports all Rally work item types: User Stories, Defects, Tasks, and Features.
 */

import { Effect } from 'effect';
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
import { IssueNotFoundError, TrackerAuthError } from './interface.js';
import { TrackerError } from '../errors.js';

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

/**
 * Validate a Rally FormattedID to prevent WSAPI query injection.
 * Rally IDs look like: US123, DE456, TA789, F012
 */
function validateRallyId(id: string): boolean {
  return /^[A-Za-z]+\d+$/.test(id);
}

/**
 * Escape a string value for use in Rally WSAPI query strings.
 * Replaces double quotes with escaped quotes to prevent query injection.
 */
function escapeQueryValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

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

const trackerErr = (operation: string, message: string, cause?: unknown) =>
  new TrackerError({ tracker: 'rally', operation, message, cause });

export class RallyTracker implements IssueTracker {
  readonly name: TrackerType = 'rally' as TrackerType;
  private restApi: RallyRestApi;
  private workspace?: string;
  private project?: string;

  constructor(config: RallyConfig) {
    if (!config.apiKey) {
      throw new TrackerAuthError({
        tracker: 'rally',
        message: 'API key is required',
      });
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
  listIssues(
    filters?: IssueFilters,
  ): Effect.Effect<Issue[], TrackerError | TrackerAuthError> {
    const self = this;
    if (process.env.DEBUG?.includes('rally')) {
      console.debug('[Rally] Query filters:', JSON.stringify(filters));
    }

    const limit = filters?.limit ?? 50;

    // Extract ObjectID from project ref for explicit query scoping
    // e.g., "/project/822404704163" → "822404704163"
    let projectObjectId: string | undefined;
    if (self.project) {
      const match = self.project.match(/\/project\/(\d+)/);
      if (match) projectObjectId = match[1];
    }

    const perTypeLimit = Math.ceil(limit / QUERYABLE_TYPES.length) * 2;

    const typeQueries = QUERYABLE_TYPES.map((artifactType) => {
      const queryString = self.buildQueryStringForType(
        filters,
        artifactType,
        projectObjectId,
      );

      if (process.env.DEBUG?.includes('rally')) {
        console.debug(`[Rally] ${artifactType.type} query:`, queryString);
      }

      const query: any = {
        type: artifactType.type,
        fetch: FETCH_FIELDS,
        limit: perTypeLimit,
        query: queryString,
      };

      if (self.workspace) query.workspace = self.workspace;
      if (self.project) {
        query.project = self.project;
        query.projectScopeDown = true;
      }

      return self.restApi.query(query).pipe(
        Effect.map((result) =>
          result.QueryResult.Results.map((artifact: any) =>
            self.normalizeIssue(artifact),
          ),
        ),
        // Log + swallow per-type errors so other types still return.
        // Auth errors propagate up.
        Effect.catchTag('TrackerError', (err) => {
          if (process.env.DEBUG?.includes('rally')) {
            console.debug(
              `[Rally] Failed to query ${artifactType.type}:`,
              err.message,
            );
          }
          return Effect.succeed([] as Issue[]);
        }),
      );
    });

    return Effect.all(typeQueries, { concurrency: 'unbounded' }).pipe(
      Effect.map((results) => {
        const allIssues = results.flat();
        allIssues.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        return allIssues.slice(0, limit);
      }),
    );
  }

  getIssue(
    id: string,
  ): Effect.Effect<Issue, IssueNotFoundError | TrackerError | TrackerAuthError> {
    const self = this;
    if (!validateRallyId(id)) {
      return Effect.fail(new IssueNotFoundError({ id, tracker: 'rally' }));
    }

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
      query: `(FormattedID = "${escapeQueryValue(id)}")`,
    };

    if (self.workspace) query.workspace = self.workspace;

    return self.restApi.query(query).pipe(
      Effect.flatMap((result) => {
        if (!result.QueryResult.Results || result.QueryResult.Results.length === 0) {
          return Effect.fail(new IssueNotFoundError({ id, tracker: 'rally' }));
        }
        return Effect.succeed(self.normalizeIssue(result.QueryResult.Results[0]));
      }),
      // Preserve legacy behaviour: convert generic API failures to not-found.
      Effect.catchTag('TrackerError', () =>
        Effect.fail(new IssueNotFoundError({ id, tracker: 'rally' })),
      ),
    );
  }

  updateIssue(
    id: string,
    update: IssueUpdate,
  ): Effect.Effect<Issue, IssueNotFoundError | TrackerError | TrackerAuthError> {
    const self = this;

    if (!validateRallyId(id)) {
      return Effect.fail(new IssueNotFoundError({ id, tracker: 'rally' }));
    }

    const query: any = {
      type: 'artifact',
      fetch: [
        'FormattedID', 'Name', 'Description', 'ScheduleState', 'State',
        'Tags', 'Owner', 'Priority', 'DueDate', 'CreationDate', 'LastUpdateDate',
        'Parent', '_type', 'ObjectID', '_ref',
      ],
      query: `(FormattedID = "${escapeQueryValue(id)}")`,
    };

    if (self.workspace) query.workspace = self.workspace;

    return self.restApi.query(query).pipe(
      Effect.flatMap((result): Effect.Effect<Issue, IssueNotFoundError | TrackerError | TrackerAuthError> => {
        if (!result.QueryResult.Results || result.QueryResult.Results.length === 0) {
          return Effect.fail(new IssueNotFoundError({ id, tracker: 'rally' }));
        }

        const artifact = result.QueryResult.Results[0];
        const updatePayload: Record<string, unknown> = {};

        if (update.title !== undefined) updatePayload.Name = update.title;
        if (update.description !== undefined) updatePayload.Description = update.description;
        if (update.state !== undefined) {
          const artifactType = (artifact._type || '').toLowerCase();
          const kind = artifactType.startsWith('portfolioitem') ? 'feature'
            : artifactType === 'defect' ? 'defect' : 'story';
          const rallyState = self.reverseMapState(update.state, kind);
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

        const applyUpdate: Effect.Effect<void, TrackerError> =
          Object.keys(updatePayload).length > 0
            ? self.restApi
                .update({
                  type: artifact._type.toLowerCase(),
                  ref: artifact._ref,
                  data: updatePayload,
                  fetch: ['FormattedID', 'ObjectID'],
                })
                .pipe(Effect.asVoid)
            : Effect.succeed(undefined);

        return applyUpdate.pipe(
          Effect.map(() => {
            // Reconstruct the normalized issue from the pre-update artifact merged
            // with the update payload to avoid an extra WSAPI round-trip.
            const updatedArtifact = { ...artifact };
            if (updatePayload.Name !== undefined) updatedArtifact.Name = updatePayload.Name;
            if (updatePayload.Description !== undefined)
              updatedArtifact.Description = updatePayload.Description;
            if (updatePayload.ScheduleState !== undefined)
              updatedArtifact.ScheduleState = updatePayload.ScheduleState;
            if (updatePayload.State !== undefined)
              updatedArtifact.State = updatePayload.State;
            if (updatePayload.Priority !== undefined)
              updatedArtifact.Priority = updatePayload.Priority;
            if (updatePayload.DueDate !== undefined)
              updatedArtifact.DueDate = updatePayload.DueDate;
            return self.normalizeIssue(updatedArtifact);
          }),
        );
      }),
    );
  }

  createIssue(
    newIssue: NewIssue,
  ): Effect.Effect<Issue, TrackerError | TrackerAuthError> {
    const self = this;

    if (!self.project && !newIssue.team) {
      return Effect.fail(
        trackerErr(
          'createIssue',
          'Project is required to create an issue. Set it in config or provide team field.',
        ),
      );
    }

    const project = newIssue.team || self.project;

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
    if (self.workspace) {
      createPayload.Workspace = self.workspace;
    }

    return self.restApi
      .create({
        type: 'hierarchicalrequirement',
        data: createPayload,
        fetch: ['FormattedID', 'ObjectID', '_ref'],
      })
      .pipe(
        Effect.flatMap((result) =>
          self.getIssue(result.CreateResult.Object.FormattedID).pipe(
            // getIssue surfaces IssueNotFoundError; map to TrackerError for the
            // narrower error type expected by createIssue's signature.
            Effect.catchTag('IssueNotFoundError', (err) =>
              Effect.fail(
                trackerErr(
                  'createIssue:fetchCreated',
                  `Created issue ${err.id} but could not refetch it`,
                ),
              ),
            ),
          ),
        ),
      );
  }

  getComments(
    issueId: string,
  ): Effect.Effect<Comment[], TrackerError | TrackerAuthError> {
    const self = this;

    if (!validateRallyId(issueId)) {
      return Effect.succeed([]);
    }

    const query: any = {
      type: 'artifact',
      fetch: ['ObjectID', '_ref', 'Discussion'],
      query: `(FormattedID = "${escapeQueryValue(issueId)}")`,
    };

    if (self.workspace) query.workspace = self.workspace;

    return self.restApi.query(query).pipe(
      Effect.flatMap((result) => {
        if (!result.QueryResult.Results || result.QueryResult.Results.length === 0) {
          return Effect.succeed([] as Comment[]);
        }

        const artifact = result.QueryResult.Results[0];
        if (!artifact.Discussion) {
          return Effect.succeed([] as Comment[]);
        }

        const postsQuery: any = {
          type: 'conversationpost',
          fetch: ['ObjectID', 'Text', 'User', 'CreationDate', 'PostNumber'],
          query: `(Discussion = "${artifact.Discussion._ref}")`,
          order: 'PostNumber',
        };

        return self.restApi.query(postsQuery).pipe(
          Effect.map((postsResult) =>
            (postsResult.QueryResult.Results || []).map((post: any) => ({
              id: post.ObjectID,
              issueId,
              body: post.Text || '',
              author: post.User?._refObjectName || 'Unknown',
              createdAt: post.CreationDate,
              updatedAt: post.CreationDate, // Rally doesn't track comment updates separately
            })),
          ),
        );
      }),
    );
  }

  addComment(
    issueId: string,
    body: string,
  ): Effect.Effect<Comment, TrackerError | TrackerAuthError> {
    const self = this;

    if (!validateRallyId(issueId)) {
      return Effect.fail(
        trackerErr('addComment', `Invalid Rally id: ${issueId}`),
      );
    }

    const query: any = {
      type: 'artifact',
      fetch: ['ObjectID', '_ref', 'Discussion'],
      query: `(FormattedID = "${escapeQueryValue(issueId)}")`,
    };

    if (self.workspace) query.workspace = self.workspace;

    return self.restApi.query(query).pipe(
      Effect.flatMap((result) => {
        if (!result.QueryResult.Results || result.QueryResult.Results.length === 0) {
          return Effect.fail(
            trackerErr('addComment', `Issue not found: ${issueId}`),
          );
        }

        const artifact = result.QueryResult.Results[0];

        return self.restApi
          .create({
            type: 'conversationpost',
            data: { Artifact: artifact._ref, Text: body },
            fetch: ['FormattedID', 'ObjectID', '_ref'],
          })
          .pipe(
            Effect.map((postResult) => ({
              id: postResult.CreateResult.Object.ObjectID,
              issueId,
              body,
              author: 'Panopticon',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })),
          );
      }),
    );
  }

  transitionIssue(
    id: string,
    state: IssueState,
  ): Effect.Effect<void, IssueNotFoundError | TrackerError | TrackerAuthError> {
    return this.updateIssue(id, { state }).pipe(Effect.asVoid);
  }

  linkPR(
    issueId: string,
    prUrl: string,
  ): Effect.Effect<void, TrackerError | TrackerAuthError> {
    return this.addComment(issueId, `Linked Pull Request: ${prUrl}`).pipe(
      Effect.asVoid,
    );
  }

  getChildIssues(
    parentId: string,
  ): Effect.Effect<Issue[], TrackerError | TrackerAuthError> {
    const self = this;
    if (!validateRallyId(parentId)) {
      return Effect.succeed([]);
    }

    const childTypes = [
      { type: 'hierarchicalrequirement', stateField: 'ScheduleState' },
      { type: 'defect', stateField: 'State' },
    ];

    const queries = childTypes.map((childType) => {
      const query: any = {
        type: childType.type,
        fetch: FETCH_FIELDS,
        query: `(PortfolioItem.FormattedID = "${escapeQueryValue(parentId)}")`,
        limit: 200,
      };

      if (self.workspace) query.workspace = self.workspace;
      if (self.project) {
        query.project = self.project;
        query.projectScopeDown = true;
      }

      return self.restApi.query(query).pipe(
        Effect.map((result) =>
          result.QueryResult.Results.map((artifact: any) =>
            self.normalizeIssue(artifact),
          ),
        ),
        Effect.catchTag('TrackerError', (err) => {
          if (process.env.DEBUG?.includes('rally')) {
            console.debug(
              `[Rally] Failed to query ${childType.type} children:`,
              err.message,
            );
          }
          return Effect.succeed([] as Issue[]);
        }),
      );
    });

    return Effect.all(queries, { concurrency: 'unbounded' }).pipe(
      Effect.map((results) => {
        const allChildren = results.flat();
        allChildren.sort((a, b) => a.ref.localeCompare(b.ref));
        return allChildren;
      }),
    );
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
      const closedConditions = artifactType.closedStates.map(
        (state) => `(${artifactType.stateField} != "${state}")`,
      );
      const closedExpr = closedConditions.reduce(
        (acc, cond) => (acc ? `(${acc} AND ${cond})` : cond),
        '',
      );
      conditions.push(closedExpr);
    }

    if (filters?.assignee) {
      conditions.push(`(Owner.Name contains "${escapeQueryValue(filters.assignee)}")`);
    }

    if (filters?.labels && filters.labels.length > 0) {
      const labelConditions = filters.labels.map(
        (label) => `(Tags.Name contains "${escapeQueryValue(label)}")`,
      );
      const labelExpr = labelConditions.reduce(
        (acc, cond) => (acc ? `(${acc} AND ${cond})` : cond),
        '',
      );
      conditions.push(labelExpr);
    }

    if (filters?.query) {
      conditions.push(
        `((Name contains "${escapeQueryValue(filters.query)}") OR (Description contains "${escapeQueryValue(filters.query)}"))`,
      );
    }

    return conditions.reduce(
      (acc, cond) => (acc ? `(${acc} AND ${cond})` : cond),
      '',
    );
  }

  private normalizeIssue(rallyArtifact: any): Issue {
    const rawStateValue =
      rallyArtifact.ScheduleState || rallyArtifact.State || 'Defined';
    const stateValue =
      typeof rawStateValue === 'object' && rawStateValue !== null
        ? (rawStateValue.Name || rawStateValue._refObjectName || 'Defined')
        : rawStateValue;
    const state = this.mapState(stateValue);

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

    const priority = rallyArtifact.Priority
      ? PRIORITY_MAP[rallyArtifact.Priority] ?? 2
      : undefined;

    const objectId = rallyArtifact.ObjectID || rallyArtifact.FormattedID;
    const artifactType = rallyArtifact._type || 'artifact';

    const baseUrl = this.restApi.server.replace('/slm/webservice/', '');
    const url = `${baseUrl}/#/detail/${artifactType.toLowerCase()}/${objectId}`;

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

  private reverseMapState(
    state: IssueState,
    kind: 'story' | 'defect' | 'feature' = 'story',
  ): string {
    if (kind === 'feature') {
      switch (state) {
        case 'open': return 'Discovering';
        case 'in_progress':
        case 'in_review': return 'Developing';
        case 'closed': return 'Done';
        default: return 'Discovering';
      }
    }
    if (kind === 'defect') {
      switch (state) {
        case 'open': return 'Submitted';
        case 'in_progress':
        case 'in_review': return 'Open';
        case 'closed': return 'Closed';
        default: return 'Submitted';
      }
    }
    switch (state) {
      case 'open': return 'Defined';
      case 'in_progress':
      case 'in_review': return 'In-Progress';
      case 'closed': return 'Completed';
      default: return 'Defined';
    }
  }
}
