import { describe, it, expect } from 'vitest';
import {
  diagnoseDuplicateComposeStacks,
  type CanonicalProjectInfo,
  type DuplicateStackContainerRow,
} from '../../../src/cli/commands/doctor-duplicate-stacks.js';

function resolver(map: Record<string, string | null>, workspacePath: string | null = '/repo/workspaces/feature-min-901') {
  return (issueId: string): CanonicalProjectInfo => ({
    project: map[issueId] ?? null,
    workspacePath,
  });
}

describe('diagnoseDuplicateComposeStacks (PAN-3049)', () => {
  it('ac1: reports a duplicate with myn- as canonical and overdeck- as foreign, with a cwd-independent fix command', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-api-1', composeProject: 'myn-feature-min-901' },
      { name: 'myn-feature-min-901-dev-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-dev-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(
      containers,
      resolver({ 'MIN-901': 'myn-feature-min-901' }, '/repo/workspaces/feature-min-901'),
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('MIN-901');
    expect(results[0].message).toContain('myn-feature-min-901');
    expect(results[0].message).toContain('overdeck-feature-min-901');
    expect(results[0].fix).toContain('foreign stack overdeck-feature-min-901 is a duplicate');
    expect(results[0].fix).toContain('docker compose -p "overdeck-feature-min-901" down');
    // The command must not depend on the operator's current directory.
    expect(results[0].fix).toContain('cd "/repo/workspaces/feature-min-901/.devcontainer"');
    expect(results[0].fix).not.toContain('myn-feature-min-901" down');
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

  // PAN-3049 review fix: never recommend stopping every running project when
  // ownership cannot be confirmed — that includes the live/canonical stack.
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

  it('emits diagnosis-only guidance when a canonical name is known but not among the running projects', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'legacy-feature-min-901-api-1', composeProject: 'legacy-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-901': 'myn-feature-min-901' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('none matching its canonical name myn-feature-min-901');
    expect(results[0].fix).not.toContain('docker compose');
    expect(results[0].fix).not.toContain('down');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-901');
  });

  // PAN-3049 review fix (cycle 2): a canonical project with only an
  // init/setup container running is not confirmed healthy — recommending a
  // foreign-stack teardown here can remove the only working stack while the
  // canonical one is still initializing.
  it('emits diagnosis-only guidance when the canonical project has only an init container running, even with a complete foreign stack', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-init-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-frontend-1', composeProject: 'overdeck-feature-min-901' },
      { name: 'overdeck-feature-min-901-dev-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-901': 'myn-feature-min-901' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
    expect(results[0].message).toContain('no running service container yet');
    expect(results[0].fix).not.toContain('docker compose');
    expect(results[0].fix).not.toContain('down');
    expect(results[0].fix).toContain('pan workspace rebuild MIN-901');
  });

  it('emits a down command when the canonical project has a real running service, not just init', () => {
    const containers: DuplicateStackContainerRow[] = [
      { name: 'myn-feature-min-901-init-1', composeProject: 'myn-feature-min-901' },
      { name: 'myn-feature-min-901-server-1', composeProject: 'myn-feature-min-901' },
      { name: 'overdeck-feature-min-901-api-1', composeProject: 'overdeck-feature-min-901' },
    ];

    const results = diagnoseDuplicateComposeStacks(containers, resolver({ 'MIN-901': 'myn-feature-min-901' }));

    expect(results).toHaveLength(1);
    expect(results[0].fix).toContain('foreign stack overdeck-feature-min-901 is a duplicate');
    expect(results[0].fix).toContain('docker compose -p "overdeck-feature-min-901" down');
  });
});
