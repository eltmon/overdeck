/**
 * workspaceRows — workspace-registry row type and the helpers that decide
 * which rows the left column and Cmd-K list (PAN-5293 F-D10, moved verbatim
 * from Sidebar.tsx).
 */

/** PAN-1990: a GET /api/workspace-registry row (src/dashboard/server/routes/workspace-registry.ts). */
export interface WorkspaceRegistryRow {
  id: string;
  projectId: string;
  kind: 'main' | 'issue' | 'scratch';
  origin: 'operator' | 'pipeline' | 'vault' | 'agent';
  name: string;
  issueId: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  title: string | null;
  lastAccessedAt: number;
  /**
   * Memory-synthesized phase for main/scratch rows, null when there is no
   * status yet and always null for issue rows, which badge the pipeline phase
   * instead (PAN-3286 FR-12).
   */
  memoryPhase?: string | null;
  /** The owning project's display name; main rows are labelled with it. */
  projectName?: string;
}

/**
 * A workspace the operator created, or one they favorited (PAN-5233). Rows
 * the pipeline, Session Vault or an agent created stay out of the rail and
 * Cmd-K; the API still returns them.
 */
export function isUserFacingWorkspace(workspace: WorkspaceRegistryRow): boolean {
  return workspace.origin === 'operator' || workspace.isFavorite;
}

/**
 * A row the left column's Workspaces section lists. A project's main
 * checkout is reached from its Home pane (Main checkout), so the section
 * lists it only when favorited. Cmd-K keeps listing main rows, under their
 * project's name.
 */
export function isRailWorkspace(workspace: WorkspaceRegistryRow): boolean {
  return isUserFacingWorkspace(workspace) && (workspace.kind !== 'main' || workspace.isFavorite);
}

export function sortWorkspaces(rows: WorkspaceRegistryRow[]): WorkspaceRegistryRow[] {
  return [...rows].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return b.lastAccessedAt - a.lastAccessedAt;
  });
}
