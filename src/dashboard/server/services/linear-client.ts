/**
 * LinearClient Effect service (PAN-449)
 *
 * Wraps @linear/sdk in an Effect service so route handlers and domain
 * services can call Linear via the typed-error channel instead of try/catch.
 */

import { Duration, Effect, Layer, Schedule, Context } from 'effect';
import { LinearClient as LinearSdkClient } from '@linear/sdk';
import { getLinearApiKey } from './tracker-config.js';
import {
  IssueNotFound,
  RateLimited,
  TrackerApiError,
  TrackerNotConfigured,
} from './typed-errors.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface LinearIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly state: { readonly id: string; readonly name: string };
  readonly team: { readonly id: string; readonly key: string };
  readonly labels: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly priority: number;
}

export interface LinearState {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface LinearLabel {
  readonly id: string;
  readonly name: string;
}

export interface LinearComment {
  readonly body: string;
  readonly author: string;
  readonly createdAt: string;
}

// ─── Service interface ────────────────────────────────────────────────────────

export type LinearClientError = TrackerApiError | RateLimited | TrackerNotConfigured;

export interface LinearClientShape {
  /**
   * Get a Linear issue by UUID or identifier (e.g., "MIN-449").
   * Fails with IssueNotFound if the issue does not exist.
   */
  readonly getIssue: (
    id: string,
  ) => Effect.Effect<LinearIssue, IssueNotFound | LinearClientError>;

  /**
   * Get all workflow states for a Linear team.
   */
  readonly getTeamStates: (
    teamId: string,
  ) => Effect.Effect<ReadonlyArray<LinearState>, LinearClientError>;

  /**
   * Transition an issue to a different workflow state.
   */
  readonly updateState: (
    issueId: string,
    stateId: string,
  ) => Effect.Effect<void, LinearClientError>;

  /**
   * Add a comment to an issue.
   */
  readonly addComment: (
    issueId: string,
    body: string,
  ) => Effect.Effect<void, LinearClientError>;

  /**
   * Find a label by name in a team's label list, or create it if absent.
   */
  readonly findOrCreateLabel: (
    teamId: string,
    name: string,
    color?: string,
  ) => Effect.Effect<LinearLabel, LinearClientError>;

  /**
   * Add a label to an issue.
   */
  readonly addLabel: (
    issueId: string,
    labelId: string,
  ) => Effect.Effect<void, LinearClientError>;

  /**
   * Remove a label from an issue.
   */
  readonly removeLabel: (
    issueId: string,
    labelId: string,
  ) => Effect.Effect<void, LinearClientError>;

  /**
   * Get comments on an issue by UUID.
   */
  readonly getComments: (
    issueId: string,
  ) => Effect.Effect<ReadonlyArray<LinearComment>, LinearClientError>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class LinearClient extends Context.Service<LinearClient, LinearClientShape>()(
  'panopticon/dashboard/LinearClient',
) {}

// ─── Live layer ───────────────────────────────────────────────────────────────

/**
 * Retry schedule for Linear API calls: up to 3 retries with exponential backoff,
 * but only when the error is RateLimited (429).
 */
const rateLimitRetry = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.retry(self, {
    while: (err) => err instanceof RateLimited,
    times: 3,
    schedule: Schedule.exponential(Duration.seconds(1)),
  });

function wrapLinearError(tracker: string, err: unknown): TrackerApiError | RateLimited {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('429')) {
    return new RateLimited({ retryAfter: 60 });
  }
  return new TrackerApiError({ tracker, message: msg, cause: err });
}

async function resolveLinearLabels(raw: any): Promise<Array<{ id: string; name: string }>> {
  const source = typeof raw?.labels === 'function'
    ? await raw.labels()
    : await raw?.labels;
  const nodes = Array.isArray(source?.nodes)
    ? source.nodes
    : Array.isArray(source)
      ? source
      : [];

  return nodes.map((label: any) => ({
    id: String(label?.id ?? ''),
    name: String(label?.name ?? ''),
  }));
}

function makeLinearClientImpl(sdk: LinearSdkClient): LinearClientShape {
  return {
    getIssue: (id) =>
      Effect.tryPromise({
        try: async () => {
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

          let raw: any;
          if (isUuid) {
            raw = await sdk.issue(id);
          } else {
            const results = await sdk.searchIssues(id, { first: 1 });
            raw = results.nodes[0];
          }

          if (!raw) {
            throw new IssueNotFound({ id });
          }

          const state = await raw.state;
          const team = await raw.team;
          const labels = await resolveLinearLabels(raw);

          return {
            id: raw.id as string,
            identifier: raw.identifier as string,
            title: raw.title as string,
            description: (raw.description ?? '') as string,
            url: raw.url as string,
            state: { id: state?.id ?? '', name: state?.name ?? '' },
            team: { id: team?.id ?? '', key: team?.key ?? '' },
            labels,
            priority: (raw.priority ?? 0) as number,
          } satisfies LinearIssue;
        },
        catch: (err) => {
          if (err instanceof IssueNotFound) return err;
          return wrapLinearError('linear', err);
        },
      }).pipe(rateLimitRetry),

    getTeamStates: (teamId) =>
      Effect.tryPromise({
        try: async () => {
          const team = await sdk.team(teamId);
          const statesConn = await team.states();
          return statesConn.nodes.map((s: any) => ({
            id: s.id as string,
            name: s.name as string,
            type: s.type as string,
          })) satisfies LinearState[];
        },
        catch: (err) => wrapLinearError('linear', err),
      }),

    updateState: (issueId, stateId) =>
      Effect.tryPromise({
        try: async () => {
          await sdk.updateIssue(issueId, { stateId });
        },
        catch: (err) => wrapLinearError('linear', err),
      }).pipe(rateLimitRetry),

    addComment: (issueId, body) =>
      Effect.tryPromise({
        try: async () => {
          await sdk.createComment({ issueId, body });
        },
        catch: (err) => wrapLinearError('linear', err),
      }).pipe(rateLimitRetry),

    findOrCreateLabel: (teamId, name, color = '#666666') =>
      Effect.tryPromise({
        try: async () => {
          const existing = await sdk.issueLabels({
            filter: { name: { eq: name }, team: { id: { eq: teamId } } },
          });
          if (existing.nodes.length > 0) {
            return { id: existing.nodes[0].id, name: existing.nodes[0].name };
          }
          const result = await sdk.createIssueLabel({ teamId, name, color });
          const created = await result.issueLabel;
          if (!created) throw new Error('Failed to create label');
          return { id: created.id, name: created.name };
        },
        catch: (err) => wrapLinearError('linear', err),
      }),

    addLabel: (issueId, labelId) =>
      Effect.tryPromise({
        try: async () => {
          const issue = await sdk.issue(issueId);
          const labelsConn = await issue.labels();
          const currentIds = labelsConn.nodes.map((l: any) => l.id as string);
          if (!currentIds.includes(labelId)) {
            await sdk.updateIssue(issueId, { labelIds: [...currentIds, labelId] });
          }
        },
        catch: (err) => wrapLinearError('linear', err),
      }),

    removeLabel: (issueId, labelId) =>
      Effect.tryPromise({
        try: async () => {
          const issue = await sdk.issue(issueId);
          const labelsConn = await issue.labels();
          const currentIds = labelsConn.nodes.map((l: any) => l.id as string);
          const newIds = currentIds.filter((id) => id !== labelId);
          if (newIds.length !== currentIds.length) {
            await sdk.updateIssue(issueId, { labelIds: newIds });
          }
        },
        catch: (err) => wrapLinearError('linear', err),
      }),

    getComments: (issueId) =>
      Effect.tryPromise({
        try: async () => {
          const issue = await sdk.issue(issueId);
          const commentsConn = await issue.comments();
          return await Promise.all(
            commentsConn.nodes.map(async (c: any) => {
              const user = await c.user;
              return {
                body: (c.body ?? '') as string,
                author: (user?.name ?? 'Unknown') as string,
                createdAt: (c.createdAt ?? '') as string,
              } satisfies LinearComment;
            }),
          );
        },
        catch: (err) => wrapLinearError('linear', err),
      }),
  };
}

export const LinearClientLive = Layer.effect(
  LinearClient,
  Effect.gen(function* () {
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      return yield* Effect.fail(new TrackerNotConfigured({ tracker: 'linear' }));
    }
    const sdk = new LinearSdkClient({ apiKey });
    return makeLinearClientImpl(sdk);
  }),
);

let _linearClientImpl: LinearClientShape | null = null;
let _linearClientApiKey: string | null = null;

function getLinearClient(): LinearClientShape {
  const apiKey = getLinearApiKey();
  if (!apiKey) {
    const fail = Effect.fail(new TrackerNotConfigured({ tracker: 'linear' }));
    return {
      getIssue: () => fail,
      getTeamStates: () => fail,
      updateState: () => fail,
      addComment: () => fail,
      findOrCreateLabel: () => fail,
      addLabel: () => fail,
      removeLabel: () => fail,
      getComments: () => fail,
    };
  }
  if (_linearClientApiKey !== apiKey || !_linearClientImpl) {
    _linearClientApiKey = apiKey;
    _linearClientImpl = makeLinearClientImpl(new LinearSdkClient({ apiKey }));
  }
  return _linearClientImpl;
}

/**
 * Layer that provides a LinearClient which dynamically checks configuration on each call.
 * This avoids caching a no-op client if the config wasn't ready at layer construction time.
 */
export const LinearClientOptionalLive = Layer.effect(
  LinearClient,
  Effect.succeed({
    getIssue: (...args) => getLinearClient().getIssue(...args),
    getTeamStates: (...args) => getLinearClient().getTeamStates(...args),
    updateState: (...args) => getLinearClient().updateState(...args),
    addComment: (...args) => getLinearClient().addComment(...args),
    findOrCreateLabel: (...args) => getLinearClient().findOrCreateLabel(...args),
    addLabel: (...args) => getLinearClient().addLabel(...args),
    removeLabel: (...args) => getLinearClient().removeLabel(...args),
    getComments: (...args) => getLinearClient().getComments(...args),
  } as LinearClientShape),
);
