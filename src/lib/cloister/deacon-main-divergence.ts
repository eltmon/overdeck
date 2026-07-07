import { listProjectsSync } from '../projects.js';
import { getMainDivergence, type MainDivergence } from '../state-plane.js';

export interface ProjectMainDivergence extends MainDivergence {
  projectKey: string;
  projectPath: string;
  checkedAt: string;
}

interface MainDivergenceState {
  mainDivergence?: ProjectMainDivergence[];
}

type ProjectConfigEntry = ReturnType<typeof listProjectsSync>[number];

export async function recordMainDivergenceHealth(
  state: MainDivergenceState,
  projects: ProjectConfigEntry[] = listProjectsSync(),
  measure: (repoPath: string) => Promise<MainDivergence> = getMainDivergence,
): Promise<string[]> {
  const checkedAt = new Date().toISOString();
  const records: ProjectMainDivergence[] = [];
  const warnings: string[] = [];

  for (const project of projects) {
    const projectPath = project.config.path;
    if (!projectPath) continue;

    let divergence: MainDivergence;
    try {
      divergence = await measure(projectPath);
    } catch {
      divergence = { ahead: 0, behind: 0 };
    }
    const projectKey = project.key ?? project.config.name ?? projectPath;
    const record: ProjectMainDivergence = {
      projectKey,
      projectPath,
      checkedAt,
      ...divergence,
    };
    records.push(record);

    if (record.ahead > 1 || record.behind > 0) {
      warnings.push(
        `Main divergence for ${projectKey}: local main ahead ${record.ahead}, behind ${record.behind} relative to origin/main`,
      );
    }
  }

  state.mainDivergence = records;
  return warnings;
}
