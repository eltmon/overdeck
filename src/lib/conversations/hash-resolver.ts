/**
 * Claude project hash → workspace path resolver (PAN-457).
 *
 * Claude Code names project directories by encoding the CWD:
 *   /home/user/Projects/myapp → -home-user-Projects-myapp
 *
 * Two strategies:
 *  1. PRIMARY: Read the `cwd` field from the first JSONL message (authoritative).
 *  2. FALLBACK: Build a reverse map from known workspaces (watchDirs + projects.yaml)
 *     by encoding each path and matching on the hash segment.
 *
 * Reverse-map is cached per resolver instance (one instance = one scan run).
 */

import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { encodeClaudeProjectDir } from '../paths.js';
import { listProjects } from '../projects.js';
import { FsError } from '../errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of resolving a project hash to a workspace path.
 */
export interface ResolvedWorkspace {
  /** The resolved absolute path to the workspace directory. Null if unresolvable. */
  workspacePath: string | null;
  /** The hash segment extracted from the JSONL file path */
  workspaceHash: string;
  /** How the resolution was accomplished */
  strategy: 'jsonl-cwd' | 'reverse-map' | 'unresolved';
  /** Warning emitted when fallback resolution found an ambiguous hash. */
  warning?: string;
}

interface ReverseMapCache {
  paths: Map<string, string>;
  collisions: Map<string, string[]>;
}

/**
 * A HashResolver instance holds a reverse-map cache for one scan run.
 * Construct one per scan and reuse across all sessions.
 */
export class HashResolver {
  private reverseMap: ReverseMapCache | null = null;
  private readonly watchDirs: string[];

  constructor(watchDirs: string[]) {
    this.watchDirs = watchDirs;
  }

  /**
   * Resolve the workspace path for a JSONL file.
   *
   * @param jsonlPath  Absolute path to the .jsonl file
   * @param cwdFromFirstMessage  cwd extracted from the first JSONL message (may be null)
   */
  async resolve(
    jsonlPath: string,
    cwdFromFirstMessage: string | null,
  ): Promise<ResolvedWorkspace> {
    const workspaceHash = extractHashFromJsonlPath(jsonlPath);

    // Strategy 1: Use cwd from the first JSONL message (most accurate)
    if (cwdFromFirstMessage && cwdFromFirstMessage.length > 0) {
      return { workspacePath: cwdFromFirstMessage, workspaceHash, strategy: 'jsonl-cwd' };
    }

    // Strategy 2: Reverse-map lookup
    const map = await this.getReverseMap();
    const collisions = map.collisions.get(workspaceHash);
    if (collisions) {
      const warning = `Ambiguous Claude project hash ${workspaceHash} matches ${collisions.join(', ')}`;
      console.warn(warning);
      return { workspacePath: null, workspaceHash, strategy: 'unresolved', warning };
    }
    const resolved = map.paths.get(workspaceHash) ?? null;
    if (resolved) {
      return { workspacePath: resolved, workspaceHash, strategy: 'reverse-map' };
    }

    return { workspacePath: null, workspaceHash, strategy: 'unresolved' };
  }

  /**
   * Build (lazily) and return the reverse map from hash → workspace path.
   * The map is computed once per resolver instance.
   */
  private async getReverseMap(): Promise<ReverseMapCache> {
    if (this.reverseMap !== null) return this.reverseMap;

    const paths = new Map<string, string>();
    const collisions = new Map<string, string[]>();
    const candidates = await collectCandidatePaths(this.watchDirs);

    for (const candidate of candidates) {
      const hash = encodeClaudeProjectDir(candidate);
      const existing = paths.get(hash);
      if (!existing) {
        paths.set(hash, candidate);
        continue;
      }
      if (existing === candidate) continue;
      const collided = collisions.get(hash) ?? [existing];
      if (!collided.includes(candidate)) collided.push(candidate);
      collisions.set(hash, collided);
      paths.delete(hash);
    }

    this.reverseMap = { paths, collisions };
    return this.reverseMap;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the hash segment from a JSONL path like:
 *   /home/user/.claude/projects/-home-user-Projects-myapp/sessions/abc.jsonl
 *   → "-home-user-Projects-myapp"
 *
 * The hash is the directory name directly under ~/.claude/projects/.
 */
export function extractHashFromJsonlPath(jsonlPath: string): string {
  // The JSONL is at ~/.claude/projects/<hash>/<session>.jsonl (possibly in a subdirectory)
  const claudeProjectsPattern = /\.claude[/\\]projects[/\\]([^/\\]+)/;
  const match = jsonlPath.match(claudeProjectsPattern);
  if (match?.[1]) return match[1];
  // Fallback: use the parent directory name
  return basename(jsonlPath.replace(/[/\\][^/\\]+$/, ''));
}

/**
 * Collect candidate workspace paths by walking watchDirs one level deep.
 * Each immediate subdirectory of a watchDir is a potential workspace.
 */
async function collectCandidatePaths(watchDirs: string[]): Promise<string[]> {
  const candidates = new Set<string>();

  for (const dir of [...watchDirs, ...projectCandidateRoots()]) {
    await addCandidateRoot(candidates, dir);
  }

  return [...candidates];
}

function projectCandidateRoots(): string[] {
  const roots: string[] = [];
  for (const { config } of listProjects()) {
    roots.push(config.path);
    if (config.workspace?.workspaces_dir) roots.push(config.workspace.workspaces_dir);
  }
  return roots;
}

async function addCandidateRoot(candidates: Set<string>, dir: string): Promise<void> {
  try {
    const resolved = dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir;
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) return;

    candidates.add(resolved);

    const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        candidates.add(join(resolved, entry.name));
      }
    }
  } catch {
    // Permission denied or non-existent directory — skip
  }
}

// ─── Effect variants (PAN-1249, additive) ────────────────────────────────────
//
// Additive Effect surface — wraps the existing class method so Effect-native
// callers can use HashResolver with a typed error channel. The Promise-based
// `resolve()` method remains canonical.

/**
 * Resolve a JSONL path to a workspace via HashResolver.
 * The underlying impl tolerates fs errors internally, so this Effect never
 * fails in practice — FsError is declared for forward-compatibility if the
 * impl ever begins propagating IO failures.
 */
export function resolveJsonlEffect(
  resolver: HashResolver,
  jsonlPath: string,
  cwdFromFirstMessage: string | null,
): Effect.Effect<ResolvedWorkspace, FsError> {
  return Effect.tryPromise({
    try: () => resolver.resolve(jsonlPath, cwdFromFirstMessage),
    catch: (cause) =>
      new FsError({ path: jsonlPath, operation: 'hash-resolve', cause }),
  });
}
