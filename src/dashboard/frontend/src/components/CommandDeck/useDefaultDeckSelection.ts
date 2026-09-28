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
  /** A pending conversation deep-link (`/conv/<name>`) must win over
   * auto-select: onSelectProject's default path clears the conversation
   * route, which would drop the deep-link before its own effect applies it
   * (mirrors the guard on the single-project auto-select effect). */
  convId?: string | null;
}

export function useDefaultDeckSelection({
  selectedProject,
  registeredProjects,
  loaded,
  onSelectProject,
  convId,
}: UseDefaultDeckSelectionOptions): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!loaded || selectedProject || registeredProjects.length > 0 || convId) return;
    firedRef.current = true;
    onSelectProject?.(NO_PROJECT_KEY);
  }, [loaded, selectedProject, registeredProjects, onSelectProject, convId]);
}
