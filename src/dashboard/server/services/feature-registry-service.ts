import type {
  FeatureRegistryEntry,
  FeatureRegistryListFilter,
  FeatureRegistryOwnershipUpdate,
  FeatureRegistryTagInput,
  FeatureRegistryUntagInput,
} from '@panctl/contracts';
import {
  initializeFeatureRegistryStorage,
  listFeatureRegistryEntries,
  showFeatureRegistryFeature,
  tagFeatureRegistryIssue,
  untagFeatureRegistryIssue,
  updateFeatureRegistryOwnership,
} from '../../../lib/registry/feature-registry-storage.js';

export function initializeFeatureRegistryForDashboard(): Promise<void> {
  return initializeFeatureRegistryStorage();
}

export function listFeatureRegistryForDashboard(filter: FeatureRegistryListFilter = {}): Promise<FeatureRegistryEntry[]> {
  return listFeatureRegistryEntries(filter);
}

export function showFeatureRegistryForDashboard(featureName: string): Promise<FeatureRegistryEntry | null> {
  return showFeatureRegistryFeature(featureName);
}

export function tagFeatureRegistryForDashboard(input: FeatureRegistryTagInput): Promise<FeatureRegistryEntry> {
  return tagFeatureRegistryIssue(input);
}

export function untagFeatureRegistryForDashboard(input: FeatureRegistryUntagInput): Promise<boolean> {
  return untagFeatureRegistryIssue(input);
}

export function updateFeatureRegistryOwnershipForDashboard(input: FeatureRegistryOwnershipUpdate): Promise<FeatureRegistryEntry[]> {
  return updateFeatureRegistryOwnership(input);
}
