import { describe, it, expect } from 'vitest';
import {
  diagnoseDuplicateComposeStacks,
  type DuplicateStackContainerRow,
} from '../../../src/cli/commands/doctor-duplicate-stacks.js';

function resolver(map: Record<string, string | null>) {
  return (issueId: string): string | null => map[issueId] ?? null;
}

describe('diagnoseDuplicateComposeStacks (PAN-3049)', () => {
  // PAN-3049 review fix (cycle 3): no container-name heuristic (init-only,
  // non-support-container, etc.) can substitute for a real application
  // health check — `docker ps` only proves a container is running, never
  // that it is serving correctly. This check therefore never emits an
  // automatic teardown command for >=2 running projects, regardless of
  // which project is canonical or what's running under it.
  it('ac1: reports a duplicate and always emits diagnosis-only guidance, never a down command', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-api-1', composeProject: 'myn-feature-min-901' },
      { name: 'myn-feature-min-901-server-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-frontend-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-901': 'myn-feature-min-901' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('MIN-901');
    expect(results[0].message).toContain('myn-feature-min-901');
    expect(results[0].message).toContain('overdeck-feature-min-901');
    expect(results[0].fix).not.toContain('docker compose');
    expect(results[0].fix).not.toContain('down');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-901');
  });

  it('ac2: emits the rebuild-first guidance when only the non-canonical stack is running, with no down command', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'overdeck-feature-min-891-api-1', composeProject: 'overdeck-feature-min-891' },
      { name: 'overdeck-feature-min-891-dev-1', composeProject: 'overdeck-feature-min-891' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-891': 'myn-feature-min-891' }));

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

    const results = diagnoseDuplicateComposeStacks(
      containers,
      resolver({ 'MIN-902': 'myn-feature-min-902', 'PAN-1140': 'overdeck-feature-pan-1140' }),
    );

    expect(results).toEqual([]);
  });

  it('ignores containers with no feature-<issue> token and no compose project label', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'overdeck-traefik', composeProject: 'overdeck-infra' },
      { name: 'some-container-no-label' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({}));

    expect(results).toEqual([]);
  });

  it('stays silent when the canonical project cannot be resolved for a single running stack', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-903-api-1', composeProject: 'myn-feature-min-903' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({}));

    expect(results).toEqual([]);
  });

  it('emits diagnosis-only guidance (no down commands) when canonical resolution fails for >=2 running projects', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-api-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({}));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('no resolvable canonical name');
    expect(results[0].fix).not.toContain('docker compose');
    expect(results[0].fix).not.toContain('down');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-901');
  });

  it('emits diagnosis-only guidance when the canonical project has only an init container running, even with a complete foreign stack', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-init-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-frontend-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-dev-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-901': 'myn-feature-min-901' }));

    expect(results).toHaveLength(1);
    expect(results[0].fix).not.toContain('docker compose');
    expect(results[0].fix).not.toContain('down');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-901');
  });

  // PAN-3049 review fix (cycle 3): the previous "not init/setup" exclusion
  // heuristic treated a running dev/database/cache container as proof the
  // canonical application was healthy. It is not — no container-name
  // heuristic is, so no down command is ever emitted here regardless of
  // which containers are running under the canonical project.
  it('never emits a down command even when the canonical project has running dev/database/cache containers (no app service)', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-dev-1', composeProject: 'myn-feature-min-901' },
      { name: 'myn-feature-min-901-postgres-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-frontend-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-901': 'myn-feature-min-901' }));

    expect(results).toHaveLength(1);
    expect(results[0].fix).not.toContain('docker compose');
    expect(results[0].fix).not.toContain('down');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-901');
  });
});
