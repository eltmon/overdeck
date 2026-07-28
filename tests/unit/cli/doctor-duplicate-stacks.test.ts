import { describe, it, expect } from 'vitest';
import {
  diagnoseDuplicateComposeStacks,
  type DuplicateStackContainerRow,
} from '../../../src/cli/commands/doctor.js';

describe('diagnoseDuplicateComposeStacks (PAN-3049)', () => {
  it('ac1: reports a duplicate with myn- as canonical and overdeck- as foreign', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-api-1', composeProject: 'myn-feature-min-901' },
      { name: 'myn-feature-min-901-dev-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-dev-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, (issueId) =>
      issueId === 'MIN-901' ? 'myn-feature-min-901' : null,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('MIN-901');
    expect(results[0].message).toContain('myn-feature-min-901');
    expect(results[0].message).toContain('overdeck-feature-min-901');
    expect(results[0].fix).toContain('foreign stack overdeck-feature-min-901 is a duplicate');
    expect(results[0].fix).toContain('docker compose -p "overdeck-feature-min-901" down');
    expect(results[0].fix).not.toContain('myn-feature-min-901" down');
  });

  it('ac2: emits the rebuild-first guidance when only the non-canonical stack is running, with no down command', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'overdeck-feature-min-891-api-1', composeProject: 'overdeck-feature-min-891' },
      { name: 'overdeck-feature-min-891-dev-1', composeProject: 'overdeck-feature-min-891' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, (issueId) =>
      issueId === 'MIN-891' ? 'myn-feature-min-891' : null,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('MIN-891');
    expect(results[0].message).toContain('overdeck-feature-min-891');
    expect(results[0].message).toContain('myn-feature-min-891');
    expect(results[0].fix).toContain('non-canonical name overdeck-feature-min-891');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-891');
    expect(results[0].fix).not.toContain('docker compose -p');
  });

  it('ac3: passes silently when each issue has exactly one project matching its canonical name', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-902-api-1', composeProject: 'myn-feature-min-902' },
      { name: 'overdeck-feature-pan-1140-server-1', composeProject: 'overdeck-feature-pan-1140' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, (issueId) => {
      if (issueId === 'MIN-902') return 'myn-feature-min-902';
      if (issueId === 'PAN-1140') return 'overdeck-feature-pan-1140';
      return null;
    });

    expect(results).toEqual([]);
  });

  it('ignores containers with no feature-<issue> token and no compose project label', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'overdeck-traefik', composeProject: 'overdeck-infra' },
      { name: 'some-container-no-label' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, () => null);

    expect(results).toEqual([]);
  });

  it('stays silent when the canonical project cannot be resolved for a single running stack', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-903-api-1', composeProject: 'myn-feature-min-903' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, () => null);

    expect(results).toEqual([]);
  });
});
