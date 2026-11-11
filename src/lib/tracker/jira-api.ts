/**
 * Jira REST client (PAN-5152).
 *
 * Thin wrapper around `fetch` for Jira Cloud (REST v3, Basic `email:token`)
 * and Jira Data Center (REST v2, Bearer personal access token). Every request
 * has a 30 s timeout built from an AbortController plus setTimeout (happy-dom
 * ignores fake timers in AbortSignal.timeout), and HTTP 429 is retried after
 * `Retry-After` seconds, at most 3 times.
 *
 * The token, the email and the Authorization header never appear in an error
 * message or a log line: messages quote the method, the URL path and the HTTP
 * status only (NFR-3).
 */

import { Effect } from 'effect';
import { TrackerError } from '../errors.js';
import { IssueNotFoundError, TrackerAuthError } from './interface.js';
import { isCloudJiraSite, jiraCredentialFix } from './jira-config.js';

export type JiraDeployment = 'cloud' | 'datacenter';

export interface JiraRestApiOptions {
  site: string;
  token: string;
  email?: string;
  deployment?: JiraDeployment;
  fetchImpl?: typeof fetch;
}

export type JiraRequestError = TrackerError | TrackerAuthError | IssueNotFoundError;

export const JIRA_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 60;

/** REST API prefix for a deployment: v3 on Cloud, v2 on Data Center. */
export function apiPath(deployment: JiraDeployment, suffix: string): string {
  const version = deployment === 'cloud' ? '3' : '2';
  return `/rest/api/${version}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

/** Trim a site URL's trailing slashes and require an http(s) scheme. */
export function normalizeJiraSite(site: string): string {
  const trimmed = site.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]/i.test(trimmed)) {
    throw new TrackerAuthError({
      tracker: 'jira',
      message: `Jira site URL must start with https:// or http://. ${jiraCredentialFix()}`,
    });
  }
  return trimmed;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number.parseInt(header, 10);
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(safe, MAX_RETRY_AFTER_SECONDS) * 1000;
}

/** Fetch with the 30 s AbortController timeout. Rejects with `'timeout'` when it fires. */
async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, JIRA_REQUEST_TIMEOUT_MS);
  try {
    return await new Promise<Response>((resolve, reject) => {
      ac.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      fetchImpl(url, { ...init, signal: ac.signal }).then(resolve, reject);
    });
  } catch (error) {
    if (timedOut) throw new Error('timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const deploymentCache = new Map<string, JiraDeployment>();

/**
 * Detect a site's deployment type (D-16). A `*.atlassian.net` host is Cloud
 * with no request. Otherwise one unauthenticated `GET /rest/api/2/serverInfo`
 * decides it: `deploymentType === 'Cloud'` is Cloud, anything else Data
 * Center. A successful probe is cached per site for the process lifetime; a
 * failed probe falls back to Data Center and is not cached.
 */
export async function detectJiraDeployment(site: string, fetchImpl: typeof fetch = fetch): Promise<JiraDeployment> {
  const normalized = normalizeJiraSite(site);
  if (isCloudJiraSite(normalized)) return 'cloud';
  const cached = deploymentCache.get(normalized);
  if (cached) return cached;
  try {
    const response = await fetchWithTimeout(fetchImpl, `${normalized}/rest/api/2/serverInfo`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return 'datacenter';
    const info = (await response.json()) as { deploymentType?: string };
    const deployment: JiraDeployment = info.deploymentType === 'Cloud' ? 'cloud' : 'datacenter';
    deploymentCache.set(normalized, deployment);
    return deployment;
  } catch {
    return 'datacenter';
  }
}

export class JiraRestApi {
  readonly site: string;
  private readonly token: string;
  private readonly email: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private deployment: JiraDeployment | undefined;

  constructor(options: JiraRestApiOptions) {
    this.site = normalizeJiraSite(options.site);
    this.token = options.token;
    this.email = options.email;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.deployment = options.deployment;
  }

  /** The deployment type: configured, else detected once and remembered. */
  resolveDeployment(): Effect.Effect<JiraDeployment> {
    const known = this.deployment;
    if (known) return Effect.succeed(known);
    return Effect.promise(() => detectJiraDeployment(this.site, this.fetchImpl)).pipe(
      Effect.tap(deployment => Effect.sync(() => { this.deployment = deployment; })),
    );
  }

  /** Request an API path relative to the version prefix, e.g. `api('GET', '/issue/PROJ-1')`. */
  api<T>(method: string, suffix: string, body?: unknown): Effect.Effect<T, JiraRequestError> {
    return this.resolveDeployment().pipe(
      Effect.flatMap(deployment => this.request<T>(method, apiPath(deployment, suffix), body)),
    );
  }

  /** Request a full path that starts with `/rest/api/`. */
  request<T>(method: string, path: string, body?: unknown): Effect.Effect<T, JiraRequestError> {
    const self = this;
    const routePath = path.split('?')[0];
    const operation = `${method.toUpperCase()} ${routePath}`;
    const fail = (message: string, cause?: unknown) =>
      new TrackerError({ tracker: 'jira', operation, message, cause });

    return Effect.gen(function* () {
      const deployment = yield* self.resolveDeployment();
      const authorization = yield* self.authorizationHeader(deployment);
      const init: RequestInit = {
        method: method.toUpperCase(),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authorization },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      };

      let response: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        response = yield* Effect.tryPromise({
          try: () => fetchWithTimeout(self.fetchImpl, `${self.site}${path}`, init),
          catch: cause =>
            cause instanceof Error && cause.message === 'timeout'
              ? fail(`Jira ${operation} timed out after ${JIRA_REQUEST_TIMEOUT_MS / 1000} s`)
              : fail(`Jira ${operation} failed: network error`, cause),
        });
        if (response.status !== 429) break;
        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          return yield* Effect.fail(fail(`Jira ${operation} failed: rate limited (HTTP 429)`));
        }
        const waitMs = retryAfterMs(response.headers.get('Retry-After'));
        yield* Effect.promise(() => delay(waitMs));
      }

      if (response.status === 401 || response.status === 403) {
        return yield* Effect.fail(new TrackerAuthError({
          tracker: 'jira',
          message: `Jira rejected the credentials (HTTP ${response.status}). ${jiraCredentialFix()}`,
        }));
      }
      if (response.status === 404) {
        const issueKey = /\/issue\/([^/]+)/.exec(routePath)?.[1];
        if (issueKey) return yield* Effect.fail(new IssueNotFoundError({ id: decodeURIComponent(issueKey), tracker: 'jira' }));
      }
      if (!response.ok) {
        return yield* Effect.fail(fail(`Jira ${operation} failed: ${response.status}`));
      }
      if (response.status === 204) return undefined as T;

      const ok = response;
      const text = yield* Effect.tryPromise({
        try: () => ok.text(),
        catch: cause => fail(`Jira ${operation} failed: unreadable response body`, cause),
      });
      if (!text) return undefined as T;
      return yield* Effect.try({
        try: () => JSON.parse(text) as T,
        catch: cause => fail(`Jira ${operation} failed: invalid JSON response`, cause),
      });
    });
  }

  private authorizationHeader(deployment: JiraDeployment): Effect.Effect<string, TrackerAuthError> {
    if (deployment === 'datacenter') return Effect.succeed(`Bearer ${this.token}`);
    if (!this.email) {
      return Effect.fail(new TrackerAuthError({
        tracker: 'jira',
        message: `Jira Cloud needs an account email with the API token. ${jiraCredentialFix()}`,
      }));
    }
    return Effect.succeed(`Basic ${Buffer.from(`${this.email}:${this.token}`).toString('base64')}`);
  }
}
