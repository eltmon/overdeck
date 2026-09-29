/**
 * Standalone transcript discovery for `pan vault` (PAN-2609, FR-14, P-14).
 *
 * `src/lib/conversations/harness-discovery.ts` reaches into
 * `src/lib/overdeck/*` for agent directories, which the import guard bans, so
 * the vault walks the two harness homes it can resume itself: Claude Code
 * (`~/.claude/projects/<slug>/<id>.jsonl`) and Codex
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`). Imports only Node
 * built-ins and the leaf storage modules.
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { claudeProjectsRoot } from '../runtimes/storage/claude-code.js';
import { codexDefaultHome, codexSessionsRoot } from '../runtimes/storage/codex.js';

export interface DiscoveredTranscript {
  nativePath: string;
  harness: 'claude-code' | 'codex';
  /** Native session id derived from the file name. */
  sessionId: string;
}

async function listDir(dir: string): Promise<Array<{ name: string; isDir: boolean }>> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }));
  } catch {
    return [];
  }
}

/** Claude Code: every `<projectsRoot>/<slug>/<uuid>.jsonl`. */
export async function discoverClaudeTranscripts(projectsRoot = claudeProjectsRoot()): Promise<DiscoveredTranscript[]> {
  const out: DiscoveredTranscript[] = [];
  for (const project of await listDir(projectsRoot)) {
    if (!project.isDir) continue;
    const dir = join(projectsRoot, project.name);
    for (const entry of await listDir(dir)) {
      if (entry.isDir || !entry.name.endsWith('.jsonl')) continue;
      out.push({ nativePath: join(dir, entry.name), harness: 'claude-code', sessionId: basename(entry.name, '.jsonl') });
    }
  }
  return out;
}

/** Codex: every `rollout-*.jsonl` under `<codexHome>/sessions/`, any depth. */
export async function discoverCodexTranscripts(codexHome = codexDefaultHome()): Promise<DiscoveredTranscript[]> {
  const out: DiscoveredTranscript[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await listDir(dir)) {
      const full = join(dir, entry.name);
      if (entry.isDir) {
        await walk(full);
        continue;
      }
      if (!entry.name.startsWith('rollout-') || extname(entry.name) !== '.jsonl') continue;
      const match = entry.name.match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
      out.push({ nativePath: full, harness: 'codex', sessionId: match ? match[1]! : basename(entry.name, '.jsonl') });
    }
  };
  await walk(codexSessionsRoot(codexHome));
  return out;
}

export async function discoverTranscripts(): Promise<DiscoveredTranscript[]> {
  const [claude, codex] = await Promise.all([discoverClaudeTranscripts(), discoverCodexTranscripts()]);
  return [...claude, ...codex];
}

/** True when `path` exists and is a regular file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
