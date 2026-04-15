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
import { encodeClaudeProjectDir } from '../paths.js';

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
}

/**
 * A HashResolver instance holds a reverse-map cache for one scan run.
 * Construct one per scan and reuse across all sessions.
 */
export class HashResolver {
  private reverseMap: Map<string, string> | null = null;
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
    const resolved = map.get(workspaceHash) ?? null;
    if (resolved) {
      return { workspacePath: resolved, workspaceHash, strategy: 'reverse-map' };
    }

    return { workspacePath: null, workspaceHash, strategy: 'unresolved' };
  }

  /**
   * Build (lazily) and return the reverse map from hash → workspace path.
   * The map is computed once per resolver instance.
   */
  private async getReverseMap(): Promise<Map<string, string>> {
    if (this.reverseMap !== null) return this.reverseMap;

    const map = new Map<string, string>();
    const candidates = await collectCandidatePaths(this.watchDirs);

    for (const candidate of candidates) {
      const hash = encodeClaudeProjectDir(candidate);
      // On hash collision, keep first match (log warning only — not thrown)
      if (!map.has(hash)) {
        map.set(hash, candidate);
      }
    }

    this.reverseMap = map;
    return map;
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

  // Also include the watchDirs themselves
  for (const dir of watchDirs) {
    try {
      const resolved = dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir;
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isDirectory()) continue;

      // The watchDir itself is a candidate
      candidates.add(resolved);

      // Walk one level of subdirectories
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

  return [...candidates];
}
