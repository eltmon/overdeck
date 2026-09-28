/**
 * PAN-4280 (WI-15, D7b) — with zero registered projects and nothing selected,
 * the Command Deck should not sit on "Select a project to open its deck"
 * forever; it opens the No-project deck once the registry has loaded.
 */
import { useEffect, useRef } from 'react';

import { NO_PROJECT_KEY } from './projectsData';
import type { RegisteredProject } from './UnknownProjectState';

export interface UseDefaultDeckSelectionOptions {
  selectedProject: string | null;
  registeredProjects: readonly RegisteredProject[];
  loaded: boolean;
  onSelectProject?: (projectName: string | null, opts?: { updateUrl?: boolean }) => void;
}

export function useDefaultDeckSelection({
  selectedProject,
  registeredProjects,
  loaded,
  onSelectProject,
}: UseDefaultDeckSelectionOptions): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!loaded || selectedProject || registeredProjects.length > 0) return;
    firedRef.current = true;
    onSelectProject?.(NO_PROJECT_KEY);
  }, [loaded, selectedProject, registeredProjects, onSelectProject]);
}
