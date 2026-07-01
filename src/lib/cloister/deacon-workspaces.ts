import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { listProjectsSync } from '../projects.js';

export interface FeatureWorkspace {
  issueId: string;
  workspacePath: string;
  projectPath: string;
}

export function listFeatureWorkspaces(): FeatureWorkspace[] {
  const projects = listProjectsSync();
  const workspaces: FeatureWorkspace[] = [];

  for (const { config: projectConfig } of projects) {
    const workspacesRoot = join(projectConfig.path, 'workspaces');
    if (!existsSync(workspacesRoot)) continue;

    let entries: string[];
    try {
      entries = readdirSync(workspacesRoot, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('feature-') && !/-slot-\d+$/.test(e.name))
        .map(e => e.name);
    } catch {
      continue;
    }

    for (const entry of entries) {
      workspaces.push({
        issueId: entry.replace(/^feature-/, '').toUpperCase(),
        workspacePath: join(workspacesRoot, entry),
        projectPath: projectConfig.path,
      });
    }
  }

  return workspaces;
}
