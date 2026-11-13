/**
 * Shared path lists for Overdeck-written files that are not work product.
 *
 * OVERDECK_PROJECT_GITIGNORE_ENTRIES are Overdeck runtime artifacts written
 * inside a project's own .pan/ and .claude/ directories (monorepo and the
 * sub-repos of a polyrepo workspace alike).
 *
 * OVERDECK_WORKSPACE_ROOT_SYNC_ENTRIES are files Overdeck writes at a
 * polyrepo workspace's root (the wrapper repo) — context sync, the agent
 * template, Hume config, and env — which the wrapper's own .gitignore must
 * also list since it is a separate git repo from the sub-repos.
 */
export const OVERDECK_PROJECT_GITIGNORE_ENTRIES = [
  '.pan/events/',
  '.pan/review/',
  '.pan/prompts/',
  '.pan/test/',
  '.claude/skills/',
] as const;

export const OVERDECK_WORKSPACE_ROOT_SYNC_ENTRIES = ['.claude/', '.mcp.json', '.hume-config', '.env'] as const;

/**
 * True when relativePath is a path Overdeck itself writes as sync/runtime
 * output (per the two entry lists above), never a user's own work product.
 */
export function isOverdeckWorkspaceSyncPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').trim();
  const allEntries = [...OVERDECK_PROJECT_GITIGNORE_ENTRIES, ...OVERDECK_WORKSPACE_ROOT_SYNC_ENTRIES];

  return allEntries.some(entry => {
    if (entry.endsWith('/')) {
      const dirName = entry.slice(0, -1);
      return normalized === dirName || normalized.startsWith(`${dirName}/`);
    }
    return normalized === entry;
  });
}
