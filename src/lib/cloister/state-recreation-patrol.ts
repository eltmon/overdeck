import type { ProjectConfig } from '../projects.js';
import { findRecreatedLegacyStatePaths } from '../state-home.js';

export async function recreatedStateWarnings(
  projects: Array<{ config: ProjectConfig }>,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const { config } of projects) {
    if (!config.path) continue;
    const recreated = await findRecreatedLegacyStatePaths(config);
    if (recreated.length > 0) warnings.push(`Migrated checkout has recreated state paths (stray writer): ${recreated.join(', ')}`);
  }
  return warnings;
}
export { reconcileProjectStatePlanes } from './state-plane-patrol.js';
