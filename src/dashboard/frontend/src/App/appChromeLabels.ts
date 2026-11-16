import { ALL_PROJECTS_KEY, ALL_PROJECTS_LABEL, NO_PROJECT_KEY, NO_PROJECT_LABEL } from '../components/CommandDeck/projectsData';
import type { Tab } from '../components/Header';
import { currentPlatform, formatSpec, type Platform } from '../lib/shortcuts/keys';

/** The app-bar crumb label for a selected deck key (PAN-5000). */
export function projectCrumbLabel(key: string): string {
  if (key === NO_PROJECT_KEY) return NO_PROJECT_LABEL;
  if (key === ALL_PROJECTS_KEY) return ALL_PROJECTS_LABEL;
  return key;
}

/** The top bar's search-box text; the box opens the command palette (PAN-5292 E-D15). Child B changes it when the palette gains files. */
export const PALETTE_SEARCH_PLACEHOLDER = 'Search issues, conversations, commands…';

/** The crumb's page title for every route outside the Command Deck (PAN-5292 E-D16). */
export const TAB_TITLES: Record<Tab, string> = {
  home: 'Home',
  pipeline: 'Pipeline',
  kanban: 'Board',
  'command-deck': 'Command Deck',
  agents: 'Agents',
  orders: 'Order books',
  flywheel: 'Flywheel',
  backlog: 'Backlog',
  resources: 'Resources',
  knowledge: 'Knowledge',
  autopreso: 'Autopreso',
  activity: 'Activity',
  metrics: 'Metrics',
  costs: 'Costs',
  skills: 'Skills',
  context: 'Context',
  health: 'Health',
  settings: 'Settings',
  'god-view': 'God View',
  deacon: 'Deacon',
  sessions: 'Sessions',
  'awaiting-merge': 'Awaiting merge',
  'workspace-new': 'New workspace',
  'project-new': 'New project',
  workspace: 'Workspace',
};

/** The search box's keycap for the palette shortcut: `⌘K` on mac, `Ctrl K` elsewhere. */
export function paletteKeycap(platform: Platform = currentPlatform()): string {
  return formatSpec(platform === 'mac' ? 'Meta+K' : 'Ctrl+K', platform);
}
