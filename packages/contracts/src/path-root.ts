// Which explorer root an absolute path belongs to (PAN-5349 O-D3 step 4).
//
// Shared by the server's `POST /api/ui/open` and the frontend's
// `rootIdForConversation`. Root ids: `workspace:<id>` (scratch workspace),
// `issue:<ID>` (feature workspace), `project:<key>` (primary checkout). Pure:
// callers pass real (symlink-resolved) paths when that matters.

export type PathRootResult =
  | { readonly kind: "root"; readonly projectKey: string; readonly rootId: string }
  | { readonly kind: "no-root"; readonly projectKey: string }
  | { readonly kind: "outside" }

export interface PathRootProject {
  readonly key: string
  readonly path: string
}

export interface PathRootScratch {
  readonly id: string
  readonly path: string
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path
}

function isAtOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

/** The longest project path at or above `path`, or null. */
function owningProject(path: string, projects: readonly PathRootProject[]): PathRootProject | null {
  let best: { project: PathRootProject; length: number } | null = null
  for (const project of projects) {
    const base = trimSlash(project.path)
    if (isAtOrUnder(path, base) && (!best || base.length > best.length)) best = { project, length: base.length }
  }
  return best?.project ?? null
}

/**
 * Map an absolute path to its explorer root, first match wins:
 * 1. a scratch workspace path containing it (longest first) → `workspace:<id>`;
 * 2. `<projectPath>/workspaces/feature-<x>/…` → `issue:<X>`;
 * 3. any other folder under `<projectPath>/workspaces/` → `no-root`;
 * 4. the longest project path containing it → `project:<key>`;
 * 5. otherwise `outside`.
 */
export function resolvePathRoot(
  absPath: string,
  projects: readonly PathRootProject[],
  scratch: readonly PathRootScratch[],
): PathRootResult {
  const path = trimSlash(absPath)

  let bestScratch: { row: PathRootScratch; length: number } | null = null
  for (const row of scratch) {
    const base = trimSlash(row.path)
    if (isAtOrUnder(path, base) && (!bestScratch || base.length > bestScratch.length)) {
      bestScratch = { row, length: base.length }
    }
  }
  if (bestScratch) {
    // A scratch workspace outside every project still has a root; the server reads its
    // project key from `resolveExplorerRoot`, so an empty key here is only a fallback.
    const owner = owningProject(path, projects)
    return { kind: "root", projectKey: owner?.key ?? "", rootId: `workspace:${bestScratch.row.id}` }
  }

  // A feature workspace lives inside its project folder, so check it before the project rule.
  let bestWorkspaces: { project: PathRootProject; dir: string } | null = null
  for (const project of projects) {
    const dir = `${trimSlash(project.path)}/workspaces`
    if (path.startsWith(`${dir}/`) && (!bestWorkspaces || dir.length > bestWorkspaces.dir.length)) {
      bestWorkspaces = { project, dir }
    }
  }
  if (bestWorkspaces) {
    const first = path.slice(bestWorkspaces.dir.length + 1).split("/")[0] ?? ""
    const slug = first.startsWith("feature-") ? first.slice("feature-".length) : ""
    return slug
      ? { kind: "root", projectKey: bestWorkspaces.project.key, rootId: `issue:${slug.toUpperCase()}` }
      : { kind: "no-root", projectKey: bestWorkspaces.project.key }
  }

  const project = owningProject(path, projects)
  return project ? { kind: "root", projectKey: project.key, rootId: `project:${project.key}` } : { kind: "outside" }
}
