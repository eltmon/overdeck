/** PAN-4264 Work Item 21: pan doctor names projects with no resolvable tracker. */
import { describe, expect, it } from 'vitest';

import { checkProjectTrackerConfig } from '../../../src/cli/commands/doctor-project-config.js';

describe('checkProjectTrackerConfig (PAN-4264)', () => {
  it('warns naming each project with no tracker', () => {
    const result = checkProjectTrackerConfig(() => [
      { key: 'overdeck', config: { name: 'Overdeck', path: '/o', github_repo: 'eltmon/overdeck' } },
      { key: 'orca', config: { name: 'orca', path: '/orca' } },
      { key: 'puzzdom', config: { name: 'puzzdom', path: '/puzzdom' } },
    ]);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('orca, puzzdom');
    expect(result.message).not.toContain('Overdeck');
    expect(result.fix).toContain('projects.yaml');
  });

  it('is ok when every project resolves a tracker', () => {
    expect(checkProjectTrackerConfig(() => [
      { key: 'myn', config: { name: 'MYN', path: '/m', issue_prefix: 'MIN' } },
    ]).status).toBe('ok');
  });
});
