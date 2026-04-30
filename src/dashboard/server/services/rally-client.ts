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
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface RallyClientShape {
  /**
   * Get a Rally artifact by FormattedID (e.g. "US1234") or ObjectID.
   */
  readonly getIssue: (
    id: string,
  ) => Effect.Effect<RallyIssue, IssueNotFound | TrackerApiError>;

  /**
   * Transition a Rally artifact to a new normalized state.
   */
  readonly updateState: (
    id: string,
    state: 'open' | 'in_progress' | 'in_review' | 'closed',
  ) => Effect.Effect<void, IssueNotFound | TrackerApiError>;

  /**
   * Add a comment to a Rally artifact.
   */
  readonly addComment: (id: string, body: string) => Effect.Effect<void, TrackerApiError>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class RallyClient extends Context.Service<RallyClient, RallyClientShape>()(
  'panopticon/dashboard/RallyClient',
) {}

// ─── Live layer ───────────────────────────────────────────────────────────────

function wrapRallyError(err: unknown): TrackerApiError | IssueNotFound | RateLimited {
  if (err instanceof IssueNotFound) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.toLowerCase().includes('rate limit') || msg.includes('429')) {
    return new RateLimited({ retryAfter: 60 });
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
        Effect.tryPromise({
          try: async () => {
            const raw = await tracker.getIssue(id);
            return {
              id: raw.id,
              ref: raw.ref,
              title: raw.title,
              description: raw.description,
              url: raw.url,
              state: raw.state,
              labels: raw.labels,
            } satisfies RallyIssue;
          },
          catch: (err) => wrapRallyError(err),
        }),

      updateState: (id, state) =>
        Effect.tryPromise({
          try: () => tracker.transitionIssue(id, state),
          catch: (err) => wrapRallyError(err),
        }),

      addComment: (id, body) =>
        Effect.tryPromise({
          try: async () => {
            await tracker.addComment(id, body);
          },
          catch: (err) => {
            if (err instanceof RateLimited) return err;
            return new TrackerApiError({ tracker: 'rally', message: String(err), cause: err });
          },
        }),
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
      updateState: () => fail,
      addComment: () => fail,
    };
  }
  const configKey = `${config.server}:${config.workspace}:${config.project}:${config.apiKey.slice(-4)}`;
  if (_rallyClientConfigKey !== configKey) {
    _rallyClientConfigKey = configKey;
    // Rebuild impl synchronously — RallyTracker is lazy-loaded inside makeRallyClientImpl
    _rallyClientImpl = null; // Will be set by makeRallyClientImpl if we had one
    // Since RallyClientLive uses dynamic import and Layer.effect, we fall back to
    // creating a minimal impl here. For simplicity, delegate to the Layer on each call.
  }
  // Return a proxy that delegates to RallyClientLive evaluation each call.
  // Since we can't easily re-evaluate the Layer here, we create an inline impl.
  return {
    getIssue: (id) =>
      Effect.gen(function* () {
        const { RallyTracker } = yield* Effect.promise(() => import('../../../lib/tracker/rally.js'));
        const tracker = new RallyTracker({
          apiKey: config.apiKey,
          server: config.server,
          workspace: config.workspace,
          project: config.project,
        });
        const raw = yield* Effect.tryPromise({
          try: () => tracker.getIssue(id),
          catch: (err) => wrapRallyError(err),
        });
        return {
          id: raw.id,
          ref: raw.ref,
          title: raw.title,
          description: raw.description,
          url: raw.url,
          state: raw.state,
          labels: raw.labels,
        } satisfies RallyIssue;
      }),

    updateState: (id, state) =>
      Effect.gen(function* () {
        const { RallyTracker } = yield* Effect.promise(() => import('../../../lib/tracker/rally.js'));
        const tracker = new RallyTracker({
          apiKey: config.apiKey,
          server: config.server,
          workspace: config.workspace,
          project: config.project,
        });
        yield* Effect.tryPromise({
          try: () => tracker.transitionIssue(id, state),
          catch: (err) => wrapRallyError(err),
        });
      }),

    addComment: (id, body) =>
      Effect.gen(function* () {
        const { RallyTracker } = yield* Effect.promise(() => import('../../../lib/tracker/rally.js'));
        const tracker = new RallyTracker({
          apiKey: config.apiKey,
          server: config.server,
          workspace: config.workspace,
          project: config.project,
        });
        yield* Effect.tryPromise({
          try: () => tracker.addComment(id, body),
          catch: (err) => {
            if (err instanceof RateLimited) return err;
            return new TrackerApiError({ tracker: 'rally', message: String(err), cause: err });
          },
        });
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
    updateState: (...args) => getRallyClient().updateState(...args),
    addComment: (...args) => getRallyClient().addComment(...args),
  } as RallyClientShape),
);
