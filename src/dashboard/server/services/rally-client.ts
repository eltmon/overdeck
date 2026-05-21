/**
 * RallyClient Effect service (PAN-449)
 *
 * Wraps the RallyTracker (src/lib/tracker/rally.ts) in an Effect service
 * with typed errors, consistent with LinearClient and GitHubClient.
 */

import { Effect, Layer, Context } from 'effect';
import { getRallyConfig } from './tracker-config.js';
import {
  IssueNotFound,
  RateLimited,
  TrackerApiError,
  TrackerNotConfigured,
} from './typed-errors.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface RallyIssue {
  readonly id: string;
  /** Formatted ID, e.g. "US1234" */
  readonly ref: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  /** Rally artifact type, e.g. "HierarchicalRequirement" or "PortfolioItem/Feature" */
  readonly artifactType: string;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface RallyChildIssue {
  readonly id: string;
  readonly ref: string;
  readonly title: string;
  readonly status: string;
  readonly description: string;
}

export type RallyClientError = IssueNotFound | TrackerApiError | TrackerNotConfigured;

export interface RallyClientShape {
  /**
   * Get a Rally artifact by FormattedID (e.g. "US1234") or ObjectID.
   */
  readonly getIssue: (
    id: string,
  ) => Effect.Effect<RallyIssue, RallyClientError>;

  /**
   * Get child issues (stories/defects) for a parent feature.
   */
  readonly getChildIssues: (
    id: string,
  ) => Effect.Effect<readonly RallyChildIssue[], RallyClientError>;

  /**
   * Transition a Rally artifact to a new normalized state.
   */
  readonly updateState: (
    id: string,
    state: 'open' | 'in_progress' | 'in_review' | 'closed',
  ) => Effect.Effect<void, RallyClientError>;

  /**
   * Add a comment to a Rally artifact.
   */
  readonly addComment: (id: string, body: string) => Effect.Effect<void, RallyClientError>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class RallyClient extends Context.Service<RallyClient, RallyClientShape>()(
  'panopticon/dashboard/RallyClient',
) {}

// ─── Live layer ───────────────────────────────────────────────────────────────

function wrapRallyError(err: unknown): TrackerApiError | IssueNotFound {
  if (err instanceof IssueNotFound) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.toLowerCase().includes('rate limit') || msg.includes('429')) {
    return new TrackerApiError({ tracker: 'rally', message: msg, cause: err });
  }
  if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('0 results')) {
    // Rally returns empty results for missing artifacts rather than 404
    return new IssueNotFound({ id: msg });
  }
  return new TrackerApiError({ tracker: 'rally', message: msg, cause: err });
}

export const RallyClientLive = Layer.effect(
  RallyClient,
  Effect.gen(function* () {
    const config = getRallyConfig();
    if (!config) {
      return yield* Effect.fail(new TrackerNotConfigured({ tracker: 'rally' }));
    }

    // Dynamic import to avoid loading Rally code when Rally is not configured
    const { RallyTracker } = yield* Effect.promise(() => import('../../../lib/tracker/rally.js'));

    const tracker = new RallyTracker({
      apiKey: config.apiKey,
      server: config.server,
      workspace: config.workspace,
      project: config.project,
    });

    return {
      getIssue: (id) =>
        tracker.getIssue(id).pipe(
          Effect.mapError(wrapRallyError),
          Effect.map((raw) => ({
            id: raw.id,
            ref: raw.ref,
            title: raw.title,
            description: raw.description,
            url: raw.url,
            state: raw.state,
            labels: raw.labels,
            artifactType: raw.artifactType || 'artifact',
          } satisfies RallyIssue)),
        ),

      getChildIssues: (id) =>
        tracker.getChildIssues(id).pipe(
          Effect.mapError(wrapRallyError),
          Effect.map((children) =>
            children.map((raw) => ({
              id: raw.id,
              ref: raw.ref,
              title: raw.title,
              status: raw.state,
              description: raw.description,
            }))),
        ),

      updateState: (id, state) =>
        tracker.transitionIssue(id, state).pipe(Effect.mapError(wrapRallyError)),

      addComment: (id, body) =>
        tracker.addComment(id, body).pipe(
          Effect.mapError((err: unknown) => {
            if (err instanceof RateLimited) {
              return new TrackerApiError({ tracker: 'rally', message: 'rate limited', cause: err });
            }
            return new TrackerApiError({ tracker: 'rally', message: String(err), cause: err });
          }),
          Effect.asVoid,
        ),
    } satisfies RallyClientShape;
  }),
);

let _rallyClientImpl: RallyClientShape | null = null;
let _rallyClientConfigKey: string | null = null;

function getRallyClient(): RallyClientShape {
  const config = getRallyConfig();
  if (!config) {
    const fail = Effect.fail(new TrackerNotConfigured({ tracker: 'rally' }));
    return {
      getIssue: () => fail,
      getChildIssues: () => fail,
      updateState: () => fail,
      addComment: () => fail,
    };
  }
  const configKey = `${config.server}:${config.workspace}:${config.project}:${config.apiKey.slice(-4)}`;
  if (_rallyClientConfigKey !== configKey || !_rallyClientImpl) {
    _rallyClientConfigKey = configKey;
    // Build a fresh impl that caches the RallyTracker instance
    _rallyClientImpl = makeRallyClientImpl(config);
  }
  return _rallyClientImpl;
}

function makeRallyClientImpl(config: NonNullable<ReturnType<typeof getRallyConfig>>): RallyClientShape {
  // Lazily create the tracker on first use so we don't pay the import cost
  // when Rally is configured but never queried.
  let tracker: import('../../../lib/tracker/rally.js').RallyTracker | null = null;

  async function getTracker() {
    if (!tracker) {
      const { RallyTracker } = await import('../../../lib/tracker/rally.js');
      tracker = new RallyTracker({
        apiKey: config.apiKey,
        server: config.server,
        workspace: config.workspace,
        project: config.project,
      });
    }
    return tracker;
  }

  return {
    getIssue: (id) =>
      Effect.gen(function* () {
        const t = yield* Effect.promise(() => getTracker());
        const raw = yield* t.getIssue(id).pipe(Effect.mapError(wrapRallyError));
        return {
          id: raw.id,
          ref: raw.ref,
          title: raw.title,
          description: raw.description,
          url: raw.url,
          state: raw.state,
          labels: raw.labels,
          artifactType: raw.artifactType || 'artifact',
        } satisfies RallyIssue;
      }),

    getChildIssues: (id) =>
      Effect.gen(function* () {
        const t = yield* Effect.promise(() => getTracker());
        const children = yield* t.getChildIssues(id).pipe(Effect.mapError(wrapRallyError));
        return children.map((raw) => ({
          id: raw.id,
          ref: raw.ref,
          title: raw.title,
          status: raw.state,
          description: raw.description,
        })) satisfies RallyChildIssue[];
      }),

    updateState: (id, state) =>
      Effect.gen(function* () {
        const t = yield* Effect.promise(() => getTracker());
        yield* t.transitionIssue(id, state).pipe(Effect.mapError(wrapRallyError));
      }),

    addComment: (id, body) =>
      Effect.gen(function* () {
        const t = yield* Effect.promise(() => getTracker());
        yield* t.addComment(id, body).pipe(
          Effect.mapError((err: unknown) => {
            if (err instanceof RateLimited) {
              return new TrackerApiError({ tracker: 'rally', message: 'rate limited', cause: err });
            }
            return new TrackerApiError({ tracker: 'rally', message: String(err), cause: err });
          }),
        );
      }),
  };
}

/**
 * Layer that provides a RallyClient which dynamically checks configuration on each call.
 * This avoids caching a no-op client if the config wasn't ready at layer construction time.
 */
export const RallyClientOptionalLive = Layer.effect(
  RallyClient,
  Effect.succeed({
    getIssue: (...args) => getRallyClient().getIssue(...args),
    getChildIssues: (...args) => getRallyClient().getChildIssues(...args),
    updateState: (...args) => getRallyClient().updateState(...args),
    addComment: (...args) => getRallyClient().addComment(...args),
  } as RallyClientShape),
);
