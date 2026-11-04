import { NO_PROJECT_KEY, NO_PROJECT_LABEL } from '../components/CommandDeck/projectsData';

/** The app-bar crumb label for a selected deck key (PAN-5000). */
export function projectCrumbLabel(key: string): string {
  return key === NO_PROJECT_KEY ? NO_PROJECT_LABEL : key;
}

/** The search button's placeholder text for a selected deck key, or null for "all projects" (PAN-5000). */
export function searchButtonText(key: string | null): string {
  return key === null || key === NO_PROJECT_KEY ? 'Search issues, conversations, commands…' : `Search ${key}…`;
}
