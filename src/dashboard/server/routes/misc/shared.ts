import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';

import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared } from '../../../../lib/tracker-utils.js';
import { getGitHubConfig } from '../../services/tracker-config.js';

// ─── Package version ──────────────────────────────────────────────────────────

export async function readPackageVersion(): Promise<string> {
  // Walk up from the running script to find the nearest package.json.
  // Works for both source (src/dashboard/server/routes/) and bundled (dist/dashboard/) layouts.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'package.json');
    try {
      return JSON.parse(await readFile(candidate, 'utf-8')).version;
    } catch { /* try parent */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

// Lazy-initialized to avoid top-level await (which would make misc.ts an async ESM module,
// risking ERR_REQUIRE_ASYNC_MODULE for any module that require()-chains through here).
let _overdeckVersion: string | null = null;
export async function getOverdeckVersion(): Promise<string> {
  if (_overdeckVersion === null) {
    _overdeckVersion = await readPackageVersion();
  }
  return _overdeckVersion;
}

// Dev mode: true when running from the repo checkout (src/ directory exists)
export const overdeckDevMode: boolean = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'dashboard'))) {
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
})();

// ─── Project mappings helpers ─────────────────────────────────────────────────

const PROJECT_MAPPINGS_FILE = join(homedir(), '.overdeck', 'project-mappings.json');

export interface ProjectMapping {
  linearProjectId: string;
  linearProjectName: string;
  linearPrefix: string;
  localPath: string;
}

export async function getProjectMappings(): Promise<ProjectMapping[]> {
  try {
    const content = await readFile(PROJECT_MAPPINGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveProjectMappings(mappings: ProjectMapping[]): Promise<void> {
  const dir = join(homedir(), '.overdeck');
  await mkdir(dir, { recursive: true });
  await writeFile(PROJECT_MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
}

// ─── Project path helper ──────────────────────────────────────────────────────

export async function getProjectPath(issuePrefix?: string): Promise<string> {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
    const mappings = await getProjectMappings();
    const mapping = mappings.find(m => m.linearPrefix === issuePrefix);
    if (mapping) return mapping.localPath;
  }
  return homedir();
}

// ─── GitHub issue helper ──────────────────────────────────────────────────────

export function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueShared(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

export function getGitHubLocalPaths(): Record<string, string> {
  const ghConfig = getGitHubConfig();
  if (!ghConfig) return {};
  const out: Record<string, string> = {};
  for (const r of ghConfig.repos) {
    const localPath = (r as { localPath?: unknown }).localPath;
    if (typeof localPath === 'string') {
      out[`${r.owner}/${r.repo}`] = localPath;
    }
  }
  return out;
}

// ─── Shared body reader ───────────────────────────────────────────────────────

export const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {} as unknown;
  }
});
