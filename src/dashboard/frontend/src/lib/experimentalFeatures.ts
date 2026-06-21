import type { Tab } from '../components/Header';
import type { SettingsConfig } from '../components/Settings/types';

export const EXPERIMENTAL_TAB_IDS = new Set<Tab>([
  'agents',
  'autopreso',
  'resources',
  'activity',
  'sessions',
  'metrics',
  'costs',
  'health',
  'skills',
  'god-view',
]);

export async function fetchExperimentalFeaturesEnabled(): Promise<boolean> {
  const res = await fetch('/api/settings');
  if (!res.ok) return false;
  const settings = await res.json() as SettingsConfig;
  return Boolean(settings.experimental?.experimentalFeatures);
}

export function isExperimentalTab(tab: Tab): boolean {
  return EXPERIMENTAL_TAB_IDS.has(tab);
}
