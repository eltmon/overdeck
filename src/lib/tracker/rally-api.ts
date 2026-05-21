/**
 * Rally WSAPI REST Client
 *
 * Thin wrapper around native fetch for Rally Web Services API v2.0.
 * Provides typed methods for query, create, and update operations.
 */

import { Effect } from 'effect';
import { TrackerError } from '../errors.js';
import { TrackerAuthError } from './interface.js';

export interface RallyQueryConfig {
  type: string;
  fetch?: string[];
  query?: string;
  limit?: number;
  workspace?: string;
  project?: string;
  projectScopeDown?: boolean;
  order?: string;
}

export interface RallyQueryResult {
  QueryResult: {
    Results: any[];
    TotalResultCount: number;
    Errors: string[];
    Warnings: string[];
  };
}

export interface RallyCreateConfig {
  type: string;
  data: any;
  fetch?: string[];
}

export interface RallyCreateResult {
  CreateResult: {
    Object: any;
    Errors: string[];
    Warnings: string[];
  };
}

export interface RallyUpdateConfig {
  type: string;
  ref: string;
  data: any;
  fetch?: string[];
}

export interface RallyUpdateResult {
  OperationResult: {
    Object: any;
    Errors: string[];
    Warnings: string[];
  };
}

export interface RallyApiConfig {
  apiKey: string;
  server?: string;
  requestOptions?: {
    headers?: Record<string, string>;
  };
}

const trackerErr = (operation: string, message: string, cause?: unknown) =>
  new TrackerError({ tracker: 'rally', operation, message, cause });

export class RallyRestApi {
  private apiKey: string;
  public server: string;
  private customHeaders: Record<string, string>;

  constructor(config: RallyApiConfig) {
    this.apiKey = config.apiKey;
    this.server = config.server || 'https://rally1.rallydev.com';
    this.customHeaders = config.requestOptions?.headers || {};
  }

  /**
   * Query Rally artifacts
   */
  query(
    config: RallyQueryConfig,
  ): Effect.Effect<RallyQueryResult, TrackerError | TrackerAuthError> {
    const self = this;

    return Effect.gen(function* () {
      const params = new URLSearchParams();

      if (config.query) params.set('query', config.query);
      if (config.fetch && config.fetch.length > 0) {
        params.set('fetch', config.fetch.join(','));
      }
      if (config.limit !== undefined) params.set('pagesize', String(config.limit));
      if (config.workspace) params.set('workspace', config.workspace);
      if (config.project) {
        params.set('project', config.project);
        if (config.projectScopeDown) params.set('projectScopeDown', 'true');
      }
      if (config.order) params.set('order', config.order);

      const url = `${self.server}/slm/webservice/v2.0/${config.type}?${params.toString()}`;

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: 'GET',
            headers: {
              'ZSESSIONID': self.apiKey,
              'Content-Type': 'application/json',
              ...self.customHeaders,
            },
          }),
        catch: (cause) => trackerErr('query', `Network error: ${String(cause)}`, cause),
      });

      if (!response.ok) {
        if (response.status === 401) {
          return yield* Effect.fail(
            new TrackerAuthError({
              tracker: 'rally',
              message:
                'Unauthorized: Invalid API key or insufficient permissions',
            }),
          );
        }
        return yield* Effect.fail(
          trackerErr(
            'query',
            `Rally API query failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const result = (yield* Effect.tryPromise({
        try: () => response.json() as Promise<RallyQueryResult>,
        catch: (cause) => trackerErr('query:parse', String(cause), cause),
      }));

      if (
        result.QueryResult.Errors &&
        result.QueryResult.Errors.length > 0
      ) {
        const errorDetail = result.QueryResult.Errors.join(', ');
        const queryDetail = config.query ? ` (Query: ${config.query})` : '';
        if (process.env.DEBUG?.includes('rally')) {
          console.error('[Rally WSAPI] Query failed:', {
            query: config.query,
            errors: result.QueryResult.Errors,
          });
        }
        return yield* Effect.fail(
          trackerErr('query', `Rally API query failed: ${errorDetail}${queryDetail}`),
        );
      }

      return result;
    });
  }

  /**
   * Create a Rally object
   */
  create(
    config: RallyCreateConfig,
  ): Effect.Effect<RallyCreateResult, TrackerError> {
    const self = this;
    return Effect.gen(function* () {
      const url = `${self.server}/slm/webservice/v2.0/${config.type}/create`;

      const body: any = { [config.type]: config.data };

      const params = new URLSearchParams();
      if (config.fetch && config.fetch.length > 0) {
        params.set('fetch', config.fetch.join(','));
      }

      const finalUrl = params.toString() ? `${url}?${params.toString()}` : url;

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(finalUrl, {
            method: 'POST',
            headers: {
              'ZSESSIONID': self.apiKey,
              'Content-Type': 'application/json',
              ...self.customHeaders,
            },
            body: JSON.stringify(body),
          }),
        catch: (cause) => trackerErr('create', `Network error: ${String(cause)}`, cause),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          trackerErr(
            'create',
            `Rally API create failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const result = yield* Effect.tryPromise({
        try: () => response.json() as Promise<RallyCreateResult>,
        catch: (cause) => trackerErr('create:parse', String(cause), cause),
      });

      if (
        result.CreateResult.Errors &&
        result.CreateResult.Errors.length > 0
      ) {
        return yield* Effect.fail(
          trackerErr(
            'create',
            `Rally API create failed: ${result.CreateResult.Errors.join(', ')}`,
          ),
        );
      }

      return result;
    });
  }

  /**
   * Update a Rally object
   */
  update(
    config: RallyUpdateConfig,
  ): Effect.Effect<RallyUpdateResult, TrackerError> {
    const self = this;
    return Effect.gen(function* () {
      // Extract ObjectID from ref (e.g., "/hierarchicalrequirement/12345" -> "12345")
      const objectId = config.ref.split('/').pop();
      const url = `${self.server}/slm/webservice/v2.0/${config.type}/${objectId}`;

      const body: any = { [config.type]: config.data };

      const params = new URLSearchParams();
      if (config.fetch && config.fetch.length > 0) {
        params.set('fetch', config.fetch.join(','));
      }

      const finalUrl = params.toString() ? `${url}?${params.toString()}` : url;

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(finalUrl, {
            method: 'POST',
            headers: {
              'ZSESSIONID': self.apiKey,
              'Content-Type': 'application/json',
              ...self.customHeaders,
            },
            body: JSON.stringify(body),
          }),
        catch: (cause) => trackerErr('update', `Network error: ${String(cause)}`, cause),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          trackerErr(
            'update',
            `Rally API update failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const result = yield* Effect.tryPromise({
        try: () => response.json() as Promise<RallyUpdateResult>,
        catch: (cause) => trackerErr('update:parse', String(cause), cause),
      });

      if (
        result.OperationResult.Errors &&
        result.OperationResult.Errors.length > 0
      ) {
        return yield* Effect.fail(
          trackerErr(
            'update',
            `Rally API update failed: ${result.OperationResult.Errors.join(', ')}`,
          ),
        );
      }

      return result;
    });
  }
}
