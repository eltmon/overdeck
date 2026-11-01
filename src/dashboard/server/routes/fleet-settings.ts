/**
 * Compare settings (PAN-4651 FR-9, D-4651-20): `GET
 * /api/fleet/settings-compare/:machine` (admin, refuses channel callers)
 * lists the `config.yaml` keys whose explicitly set values differ between
 * this machine and a linked one.
 *
 * Answer: `{ machine: { environmentId, label }, dashboardUrl, differences:
 * [{ key, here, there, copyLine }] }`, keys sorted, `null` meaning "not set
 * (default)". `copyLine` is `pan admin config set <key> <value>` (value
 * shell-quoted) for making that machine match this one; it is null for
 * secrets and when this machine does not set the key. Secret values never
 * leave either machine, so two set secrets cannot be told apart: a secret is
 * listed whenever either side sets it. `dashboardUrl` is `https://<name>/`
 * from the link's Tailscale (`tailnet`) `wss://<name>/ws/link` route, else null.
 * Compare is read-only: links never change settings.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import { getLink, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { readResolvedSettings, type ResolvedSetting } from '../../../lib/settings-resolved.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';

export interface SettingsDifference {
  key: string;
  here: ResolvedSetting | null;
  there: ResolvedSetting | null;
  copyLine: string | null;
}

/** A shell word: bare when safe, else single-quoted. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_.,:/@%+=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

const isSecret = (setting: ResolvedSetting | null): setting is { secret: true; set: boolean } => !!setting && 'secret' in setting;

export function compareSettings(here: Record<string, ResolvedSetting>, there: Record<string, ResolvedSetting>): SettingsDifference[] {
  const keys = [...new Set([...Object.keys(here), ...Object.keys(there)])].sort();
  const differences: SettingsDifference[] = [];
  for (const key of keys) {
    const mine = here[key] ?? null;
    const theirs = there[key] ?? null;
    if (isSecret(mine) || isSecret(theirs)) {
      const mineSet = isSecret(mine) ? mine.set : mine !== null;
      const theirsSet = isSecret(theirs) ? theirs.set : theirs !== null;
      if (!mineSet && !theirsSet) continue;
      differences.push({ key, here: mine, there: theirs, copyLine: null });
      continue;
    }
    if (mine && theirs && mine.value === theirs.value) continue;
    differences.push({ key, here: mine, there: theirs, copyLine: mine ? `pan admin config set ${key} ${shellQuote(mine.value)}` : null });
  }
  return differences;
}

/** `https://<name>/` from a tailnet `wss://<name>/ws/link` route; else null. */
export function tailnetDashboardUrl(link: Pick<MachineLink, 'routes'>): string | null {
  for (const route of link.routes) {
    if (route.kind !== 'tailnet') continue;
    const match = /^wss:\/\/([^/:]+)(?::\d+)?\/ws\/link$/.exec(route.url);
    if (match) return `https://${match[1]}/`;
  }
  return null;
}

export interface SettingsCompareDeps {
  getLink: (machine: string) => Promise<MachineLink | null>;
  here: () => Promise<Record<string, ResolvedSetting>>;
  there: (environmentId: string) => Promise<{ status: number; json: unknown }>;
}

const defaultDeps: SettingsCompareDeps = {
  getLink,
  here: () => readResolvedSettings(),
  there: (environmentId) => linkFetch(environmentId, '/api/settings/resolved', { actor: 'operator' }),
};

export async function buildSettingsCompare(machine: string, deps: SettingsCompareDeps = defaultDeps): Promise<{ status: number; body: unknown }> {
  const link = await deps.getLink(machine);
  if (!link || link.revokedAt) return { status: 404, body: { code: 'unknown-machine', error: `No linked machine is called ${machine}` } };
  let answer: { status: number; json: unknown };
  try {
    answer = await deps.there(link.environmentId);
  } catch (error) {
    return { status: 503, body: { code: 'machine-unreachable', error: `${link.label}: ${(error as Error).message}` } };
  }
  const settings = (answer.json as { settings?: unknown } | null)?.settings;
  if (answer.status !== 200 || !settings || typeof settings !== 'object') {
    return { status: 409, body: { code: 'peer-too-old', error: `${link.label} needs a newer Overdeck to compare settings (it answered ${answer.status})` } };
  }
  return {
    status: 200,
    body: {
      machine: { environmentId: link.environmentId, label: link.label },
      dashboardUrl: tailnetDashboardUrl(link),
      differences: compareSettings(await deps.here(), settings as Record<string, ResolvedSetting>),
    },
  };
}

const compareRoute = HttpRouter.add(
  'GET',
  '/api/fleet/settings-compare/:machine',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    const machine = (yield* HttpRouter.params)['machine'] ?? '';
    const result = yield* Effect.promise(() => buildSettingsCompare(machine));
    return jsonResponse(result.body, { status: result.status });
  }),
);

export const fleetSettingsRouteLayer = Layer.mergeAll(compareRoute);
