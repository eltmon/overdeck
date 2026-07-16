import { CircleAlert, Compass } from 'lucide-react';
import { NO_PROJECT_KEY } from './projectsData';
import styles from './styles/command-deck.module.css';

export interface RegisteredProject {
  key: string;
  name?: string;
  path: string;
}

export async function fetchRegisteredProjects(): Promise<RegisteredProject[]> {
  const res = await fetch('/api/registered-projects');
  if (!res.ok) throw new Error('Failed to fetch registered projects');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function findRegisteredProject(
  projects: readonly RegisteredProject[],
  selectedProject: string | null,
): RegisteredProject | undefined {
  return projects.find((project) =>
    project.key === selectedProject || project.name === selectedProject,
  );
}

export function isKnownProject(
  selectedProject: string,
  registeredProjects: readonly RegisteredProject[],
): boolean {
  return selectedProject === NO_PROJECT_KEY
    || findRegisteredProject(registeredProjects, selectedProject) !== undefined;
}

interface ProjectRegistryErrorStateProps {
  onRetry: () => void;
}

export function ProjectRegistryErrorState({ onRetry }: ProjectRegistryErrorStateProps) {
  return (
    <div className={styles.contentEmpty} role="alert">
      <div className={styles.unknownProject}>
        <CircleAlert size={48} aria-hidden="true" />
        <h2>Couldn’t load projects</h2>
        <p>Project registration could not be verified.</p>
        <button type="button" className={styles.unknownProjectRetry} onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

interface UnknownProjectStateProps {
  project: string;
  registeredProjects: readonly RegisteredProject[];
  onSelectProject?: (projectName: string | null, opts?: { updateUrl?: boolean }) => void;
}

export function UnknownProjectState({
  project,
  registeredProjects,
  onSelectProject,
}: UnknownProjectStateProps) {
  return (
    <div className={styles.contentEmpty}>
      <div className={styles.unknownProject}>
        <Compass size={48} aria-hidden="true" />
        <h2>Unknown project</h2>
        <p><code>{project}</code> is not a registered project.</p>
        {registeredProjects.length > 0 && (
          <div className={styles.unknownProjectList} aria-label="Registered projects">
            {registeredProjects.map((registeredProject) => {
              const projectName = registeredProject.name ?? registeredProject.key;
              return (
                <button
                  key={registeredProject.key}
                  type="button"
                  onClick={() => onSelectProject?.(projectName)}
                >
                  {projectName}
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          className={styles.unknownProjectBack}
          onClick={() => onSelectProject?.(null)}
        >
          Back to Command Deck
        </button>
      </div>
    </div>
  );
}
