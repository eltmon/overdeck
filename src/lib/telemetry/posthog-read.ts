/**
 * PAN-4264: the only PostHog *read* door — the `pan doctor github-quota`
 * remote view of the other installs one operator runs.
 *
 * With operator grouping on and a PostHog personal API key plus project id
 * configured (`telemetry.posthog_read_key` / `telemetry.posthog_project_id`
 * in `~/.overdeck/config.yaml`, or `OVERDECK_POSTHOG_READ_KEY` /
 * `OVERDECK_POSTHOG_PROJECT_ID`), doctor asks PostHog's HogQL query API for
 * every install (distinct id) that sent this `operatorHash` in the last 48
 * hours. The hash travels as a HogQL placeholder value, never spliced into
 * the SQL. Any failure reads as "no other installs"; doctor never fails.
 */
import { loadConfigSync } from '../config-yaml.js';

export const POSTHOG_READ_TIMEOUT_MS = 10_000;
const DEFAULT_POSTHOG_QUERY_HOST = 'https://us.posthog.com';

export const OPERATOR_INSTALLS_HOGQL = `SELECT distinct_id, argMax(properties.platform, timestamp), argMax(properties.arch, timestamp),
       argMax(properties.overdeckVersion, timestamp), max(timestamp),
       argMaxIf(properties, timestamp, event = 'github_quota_sample')
FROM events
WHERE properties.operatorHash = {operatorHash} AND timestamp > now() - INTERVAL 48 HOUR
GROUP BY distinct_id`;

export interface RemoteInstall {
  distinctId: string;
  platform: string | null;
  arch: string | null;
  version: string | null;
  lastSeen: string | null;
  /** The bucketed `graphql_*` properties of the install's last github_quota_sample. */
  lastQuotaSample: Record<string, string> | null;
}

export interface PostHogReadConfig {
  readKey?: string;
  projectId?: string;
  host: string;
}

/** The ingestion host with `.i.` removed (`us.i.posthog.com` → `us.posthog.com`). */
export function posthogQueryHost(ingestHost: string | undefined = process.env.POSTHOG_HOST): string {
  if (!ingestHost) return DEFAULT_POSTHOG_QUERY_HOST;
  return ingestHost.replace('.i.posthog.com', '.posthog.com').replace(/\/+$/, '');
}

export function resolvePostHogReadConfig(): PostHogReadConfig {
  let fromConfig: { posthog_read_key?: string; posthog_project_id?: string } = {};
  try {
    fromConfig = loadConfigSync().config.telemetry ?? {};
  } catch {
    // Unreadable config: env only.
  }
  const readKey = process.env.OVERDECK_POSTHOG_READ_KEY?.trim() || fromConfig.posthog_read_key;
  const projectId = process.env.OVERDECK_POSTHOG_PROJECT_ID?.trim() || fromConfig.posthog_project_id;
  return {
    ...(readKey ? { readKey } : {}),
    ...(projectId ? { projectId } : {}),
    host: posthogQueryHost(),
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function quotaSample(value: unknown): Record<string, string> | null {
  let properties: unknown = value;
  if (typeof value === 'string') {
    try {
      properties = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!properties || typeof properties !== 'object') return null;
  const entries = Object.entries(properties as Record<string, unknown>)
    .filter(([key, bucket]) => key.startsWith('graphql_') && typeof bucket === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) as Record<string, string> : null;
}

/** Other installs that sent `operatorHash` in the last 48 hours. Never throws; [] on any failure. */
export async function listInstallsForOperator(input: {
  operatorHash: string;
  readKey: string;
  projectId: string;
  host: string;
  ownDistinctId: string;
  fetchImpl?: typeof fetch;
}): Promise<RemoteInstall[]> {
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${input.host}/api/projects/${encodeURIComponent(input.projectId)}/query/`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.readKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: { kind: 'HogQLQuery', query: OPERATOR_INSTALLS_HOGQL, values: { operatorHash: input.operatorHash } },
        }),
        signal: AbortSignal.timeout(POSTHOG_READ_TIMEOUT_MS),
      },
    );
    if (!response.ok) return [];
    const body = await response.json() as { results?: unknown };
    if (!Array.isArray(body.results)) return [];
    return body.results
      .filter((row): row is unknown[] => Array.isArray(row) && typeof row[0] === 'string')
      .filter((row) => row[0] !== input.ownDistinctId)
      .map((row) => ({
        distinctId: row[0] as string,
        platform: text(row[1]),
        arch: text(row[2]),
        version: text(row[3]),
        lastSeen: text(row[4]),
        lastQuotaSample: quotaSample(row[5]),
      }));
  } catch {
    return [];
  }
}
