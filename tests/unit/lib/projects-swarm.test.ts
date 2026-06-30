import { describe, expect, it } from 'vitest';
import { getProjectSwarmHotspots, type ProjectConfig } from '../../../src/lib/projects.js';

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: 'Test',
    path: '/repo/test',
    ...overrides,
  };
}

describe('getProjectSwarmHotspots', () => {
  it('returns declared project hotspot patterns', () => {
    expect(getProjectSwarmHotspots(project({
      swarm: { hotspots: ['CHANGELOG.md', 'bun.lock', 'src/generated/**'] },
    }))).toEqual(['CHANGELOG.md', 'bun.lock', 'src/generated/**']);
  });

  it('defaults to an empty list when swarm hotspots are not declared', () => {
    expect(getProjectSwarmHotspots(project())).toEqual([]);
  });
});
