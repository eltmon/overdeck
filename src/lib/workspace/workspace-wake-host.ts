/**
 * PAN-5649: the pure rules behind the workspace wake host, plus the one Docker
 * read that finds a workspace's app host.
 *
 * When PAN-5250 idle-stops a workspace's frontend, its Traefik label router
 * disappears. A low-priority wake router (rendered here) then catches
 * `feature-<issue>.<domain>` and forwards it to the dashboard with a marker
 * header; the dashboard serves a wake page and starts the stack again.
 *
 * Imports stay narrow (NFR-5): nothing from `src/dashboard/`, and never
 * `src/lib/traefik.ts` (it spawns child processes). The dashboard imports the
 * pure renderer from this module instead. Docker calls use promisified
 * `execFile` with an argument array through `resolveHostTool` (NFR-2), and
 * every container name passes `CONTAINER_NAME_RE` before it reaches `docker`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadConfigSync } from '../config.js';
import { noteHostToolSpawnFailed, resolveHostTool } from '../host-tools.js';
import { loadProjectsConfigSync } from '../projects.js';
import { CONTAINER_NAME_RE } from './stack-reclaim-docker.js';

const execFileAsync = promisify(execFile);

/** A workspace app host: `feature-<issue id, lower case>.<domain>`. */
export const WAKE_HOST_RE = /^feature-([a-z0-9]+-[0-9]+)\.([a-z0-9.-]+)$/;
/** The host shape the Traefik wake router matches (its HostRegexp rule), case-insensitive. */
const WAKE_ROUTER_HOST_RE = /^feature-[a-z0-9]+-[0-9]+\..+$/i;
/** Answered by the dashboard (never wakes) while the wake router serves the host. */
export const WAKE_STATUS_PATH = '/__overdeck_wake/status';
/** Response header that marks a dashboard wake answer (FR-8, FR-9). */
export const WAKE_HEADER = 'x-overdeck-wake';
/** Request header set by the Traefik wake-router middleware (D12). */
export const WAKE_ROUTER_HEADER = 'x-overdeck-wake-router';
/** File name of the wake router under `~/.overdeck/traefik/dynamic/` (D6). */
export const WORKSPACE_WAKE_DYNAMIC_FILE = 'workspace-wake.yml';

const DEFAULT_TRAEFIK_DOMAIN = 'overdeck.localhost';
const WAKE_DOMAINS_TTL_MS = 30_000;
const DOCKER_TIMEOUT_MS = 10_000;

type NodeHeaders = Record<string, string | string[] | undefined>;

function headerValue(headers: NodeHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Host header → `{ issueId (upper case), domain, hostname }` or null. Strips a `:port` and lower-cases. */
export function parseWakeHost(host: string | undefined): { issueId: string; domain: string; hostname: string } | null {
  if (!host) return null;
  const hostname = host.trim().toLowerCase().replace(/:\d+$/, '');
  const match = WAKE_HOST_RE.exec(hostname);
  if (!match) return null;
  return { issueId: match[1].toUpperCase(), domain: match[2], hostname };
}

/** FR-2: true when the request came through the wake router (marker `1`) and its Host is a workspace app host. */
export function isWakeRouterRequest(headers: NodeHeaders): boolean {
  if (headerValue(headers, WAKE_ROUTER_HEADER)?.trim() !== '1') return false;
  // Match the wake router's own rule, not the stricter WAKE_HOST_RE: every request the
  // router forwards is consumed, and the handler rejects an invalid host with 404.
  return WAKE_ROUTER_HOST_RE.test((headerValue(headers, 'host') ?? '').trim());
}

/** FR-5: the `Accept: text/x-vite-ping` fetch an older Vite client sends to decide whether to reload a tab. */
export function isVitePing(headers: NodeHeaders): boolean {
  return (headerValue(headers, 'accept') ?? '').toLowerCase().includes('text/x-vite-ping');
}

/**
 * FR-5: true when the request may start containers — a script or tool without
 * `Sec-Fetch-Mode`, or a browser navigation. Subresources, fetches, WebSocket
 * upgrades and Vite pings never wake.
 */
export function isWakingRequest(headers: NodeHeaders): boolean {
  if (isVitePing(headers)) return false;
  const mode = headerValue(headers, 'sec-fetch-mode');
  if (mode === undefined) return true;
  return mode.trim().toLowerCase() === 'navigate';
}

/** `traefikDomain` (default `overdeck.localhost`) plus every project's `workspace.dns.domain`, lower case. */
export function wakeDomains(
  traefikDomain: string | undefined,
  projects: Record<string, { workspace?: { dns?: { domain?: string } } } | undefined>,
): Set<string> {
  const domains = new Set<string>([(traefikDomain?.trim() || DEFAULT_TRAEFIK_DOMAIN).toLowerCase()]);
  for (const project of Object.values(projects ?? {})) {
    const domain = project?.workspace?.dns?.domain;
    if (typeof domain === 'string' && domain.trim()) domains.add(domain.trim().toLowerCase());
  }
  return domains;
}

let wakeDomainsCache: { at: number; domains: Set<string> } | null = null;

/** The live wake domains from config.toml and projects.yaml, cached for 30 s. Never throws. */
export function currentWakeDomains(now: number = Date.now()): Set<string> {
  if (wakeDomainsCache && now - wakeDomainsCache.at < WAKE_DOMAINS_TTL_MS) return wakeDomainsCache.domains;
  let domains: Set<string>;
  try {
    domains = wakeDomains(loadConfigSync().traefik?.domain, loadProjectsConfigSync().projects ?? {});
  } catch {
    domains = new Set([DEFAULT_TRAEFIK_DOMAIN]);
  }
  wakeDomainsCache = { at: now, domains };
  return domains;
}

/** Test seam: forget the cached wake domains. */
export function resetWakeDomainsCacheForTests(): void {
  wakeDomainsCache = null;
}

/** FR-1: the Traefik dynamic YAML for the wake router. Pure; mode-independent. */
export function renderWorkspaceWakeTraefikConfig(apiPort: number): string {
  return [
    '# Generated by Overdeck (PAN-5649) -- do not edit manually.',
    '# Answers feature-<issue>.<domain> only when no workspace frontend router matches',
    '# (the frontend is stopped); the dashboard serves a wake page and starts the stack.',
    'http:',
    '  routers:',
    '    overdeck-workspace-wake:',
    '      rule: "HostRegexp(`^feature-[a-z0-9]+-[0-9]+\\\\..+$`)"',
    '      priority: 1',
    '      entryPoints:',
    '        - websecure',
    '      middlewares:',
    '        - overdeck-workspace-wake-marker',
    '      service: overdeck-workspace-wake',
    '      tls: {}',
    '  middlewares:',
    '    overdeck-workspace-wake-marker:',
    '      headers:',
    '        customRequestHeaders:',
    '          X-Overdeck-Wake-Router: "1"',
    '  services:',
    '    overdeck-workspace-wake:',
    '      loadBalancer:',
    '        servers:',
    `          - url: "http://host.docker.internal:${apiPort}"`,
    '',
  ].join('\n');
}

const ROUTER_RULE_KEY_RE = /^traefik\.http\.routers\.[^.]+\.rule$/;
const HOST_IN_RULE_RE = /Host\((?:`([^`]+)`|"([^"]+)")\)/g;

/**
 * Label maps → the first host inside a `traefik.http.routers.*.rule`
 * `Host(\`…\`)` whose first DNS label is exactly `feature-<issue lower>`. Pure.
 */
export function labelHostFromLabels(issueId: string, labelMaps: ReadonlyArray<Record<string, string>>): string | null {
  const wantedLabel = `feature-${issueId.toLowerCase()}`;
  for (const labels of labelMaps) {
    for (const [key, rule] of Object.entries(labels ?? {})) {
      if (!ROUTER_RULE_KEY_RE.test(key) || typeof rule !== 'string') continue;
      for (const match of rule.matchAll(HOST_IN_RULE_RE)) {
        const host = (match[1] ?? match[2] ?? '').trim().toLowerCase();
        if (host.split('.')[0] === wantedLabel && host.includes('.')) return host;
      }
    }
  }
  return null;
}

async function defaultRunDocker(args: readonly string[]): Promise<string | null> {
  const docker = resolveHostTool('docker');
  if (docker === null) return null;
  try {
    const { stdout } = await execFileAsync(docker, [...args], { timeout: DOCKER_TIMEOUT_MS, encoding: 'utf8' });
    return stdout;
  } catch (error) {
    noteHostToolSpawnFailed('docker', error);
    return null;
  }
}

/**
 * The app host the issue's frontend router declares, read from the labels of
 * its compose project's containers (running or exited). Null on any failure.
 */
export async function readWorkspaceLabelHost(
  issueId: string,
  composeProject: string,
  deps: Partial<{ runDocker: (args: readonly string[]) => Promise<string | null> }> = {},
): Promise<string | null> {
  if (!CONTAINER_NAME_RE.test(composeProject)) return null;
  const runDocker = deps.runDocker ?? defaultRunDocker;
  try {
    const listing = await runDocker(['ps', '-a', '--filter', `label=com.docker.compose.project=${composeProject}`, '--format', '{{.Names}}']);
    if (listing === null) return null;
    const names = listing
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name && CONTAINER_NAME_RE.test(name));
    if (names.length === 0) return null;
    const inspected = await runDocker(['inspect', '--format', '{{json .Config.Labels}}', ...names]);
    if (inspected === null) return null;
    const labelMaps: Record<string, string>[] = [];
    for (const line of inspected.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const labels = parsed as Record<string, string>;
        // A name can be reused between `docker ps` and `docker inspect`; keep only this project's containers.
        if (labels['com.docker.compose.project'] !== composeProject) continue;
        labelMaps.push(labels);
      } catch {
        // A line that is not JSON is skipped.
      }
    }
    return labelHostFromLabels(issueId, labelMaps);
  } catch {
    return null;
  }
}
