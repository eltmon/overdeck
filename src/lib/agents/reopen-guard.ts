import { clearRecordPipelineClosedOut } from '../pan-dir/record-update.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
  type ResolvedProject,
} from '../projects.js';

export interface AgentSpawnReopenGuardDeps {
  resolveProject: (issueId: string) => ResolvedProject | null;
  getProject: (projectKey: string) => ProjectConfig | null;
  hasClosedOutRecord: (project: ProjectConfig, issueId: string) => boolean;
  clearClosedOut: (project: ProjectConfig, issueId: string) => Promise<boolean>;
  log: (message: string) => void;
}

function defaultDeps(): AgentSpawnReopenGuardDeps {
  return {
    resolveProject: resolveProjectFromIssueSync,
    getProject: getProjectSync,
    hasClosedOutRecord: (project, issueId) => {
      const record = readIssueRecordSync(project, issueId);
      return record?.pipeline.closedOut === true || Boolean(record?.pipeline.closedOutAt);
    },
    clearClosedOut: (project, issueId) => clearRecordPipelineClosedOut(project, issueId),
    log: (message) => console.log(message),
  };
}

/** Clear stale terminal record state immediately before a new agent process starts. */
export async function clearStaleClosedOutBeforeSpawn(
  issueId: string,
  deps: AgentSpawnReopenGuardDeps = defaultDeps(),
): Promise<boolean> {
  const normalizedIssueId = issueId.toUpperCase();
  const resolved = deps.resolveProject(normalizedIssueId);
  if (!resolved) {
    deps.log(`[spawn] ${normalizedIssueId} has no configured project; no close-out record was checked`);
    return false;
  }
  const project = deps.getProject(resolved.projectKey);
  if (!project) {
    deps.log(`[spawn] ${normalizedIssueId} resolved missing project ${resolved.projectKey}; no close-out record was checked`);
    return false;
  }
  if (!deps.hasClosedOutRecord(project, normalizedIssueId)) return false;

  const changed = await deps.clearClosedOut(project, normalizedIssueId);
  if (changed) {
    deps.log(`[spawn] Cleared stale closedOut state for ${normalizedIssueId} before agent launch`);
  }
  return changed;
}
