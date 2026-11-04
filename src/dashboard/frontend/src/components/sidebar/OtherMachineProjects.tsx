/**
 * Projects across machines in the sidebar (PAN-4651 FR-4, D-4651-13).
 *
 * `useFleetProjects` reads `GET /api/fleet/projects` and keeps the project
 * resolver's git-origin index current, so a linked machine's conversation
 * attaches to the local project with the same repository while Combine is on.
 * `ProjectMachineCount` adds a muted "· N machines" (this machine counted) to a
 * project held by several machines; `OtherMachineProjects` lists repositories
 * only other machines hold, under "On other machines". Machine labels are
 * muted text, never a badge.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { setFleetProjectIndex } from '../CommandDeck/projectsData';
import { FLEET_PROJECTS_QUERY_KEY, type FleetProjectsResponse, loadFleetProjects, loadMachines, MACHINES_QUERY_KEY } from '../Settings/anywhere/machinesApi';
import { AddProjectToMachineDialog, type AddProjectTarget } from './AddProjectToMachineDialog';

export function useFleetProjects(): FleetProjectsResponse | undefined {
  const { data } = useQuery({ queryKey: FLEET_PROJECTS_QUERY_KEY, queryFn: loadFleetProjects, staleTime: 15_000, refetchInterval: 30_000 });
  useEffect(() => {
    if (!data) return;
    const localKeyByOrigin = new Map<string, string>();
    for (const row of data.projects) if (row.gitOrigin && row.local) localKeyByOrigin.set(row.gitOrigin.toLowerCase(), row.local.key);
    setFleetProjectIndex({ combine: data.combine, localKeyByOrigin });
  }, [data]);
  return data;
}

/** `· 2 machines` after a project name when other machines hold the same repository. */
export function ProjectMachineCount({ projectKey }: { projectKey: string }) {
  const data = useFleetProjects();
  const row = data?.combine ? data.projects.find((project) => project.local?.key === projectKey) : undefined;
  const count = row ? row.machines.length + 1 : 1;
  if (count < 2) return null;
  return <span className="text-[11px] text-muted-foreground/70 shrink-0" data-testid={`project-machine-count-${projectKey}`}>· {count} machines</span>;
}

/** Repositories only linked machines hold, each with Add this project to <this machine>. */
export function OtherMachineProjects() {
  const data = useFleetProjects();
  const { data: machines } = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines, staleTime: 60_000 });
  const [adding, setAdding] = useState<AddProjectTarget | null>(null);
  const remoteOnly = data?.combine ? data.projects.filter((project) => project.local === null) : [];
  if (remoteOnly.length === 0) return null;
  const thisLabel = machines?.self.label ?? 'this machine';
  return (
    <div className="mt-2" data-testid="sidebar-other-machine-projects">
      <p className="px-3 py-1 text-[11px] text-muted-foreground">On other machines</p>
      {remoteOnly.map((project) => {
        const source = project.machines.find((machine) => machine.state === 'online') ?? project.machines[0];
        return (
          <div key={project.gitOrigin ?? project.name} className="px-3 py-1.5 text-sm text-muted-foreground" data-testid={`sidebar-remote-project-${project.name}`}>
            <span className="truncate block">{project.name}</span>
            <span className="block text-[11px] text-muted-foreground/70 truncate">on {project.machines.map((machine) => machine.label).join(', ')}</span>
            {source && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => setAdding({ machine: source.environmentId, machineLabel: source.label, projectKey: source.key, projectName: project.name, thisLabel })}
              >
                Add this project to {thisLabel}
              </button>
            )}
          </div>
        );
      })}
      {adding && <AddProjectToMachineDialog target={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
