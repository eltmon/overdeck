import { describe, expect, it, vi } from 'vitest';

import {
  parseNetworkRows,
  selectOrphanedWorkspaceNetworks,
  workspaceNetworkIdentity,
  type DockerNetworkRow,
  type OrphanNetworkDeps,
} from '../orphan-networks.js';

// PAN-3900: the selector is pure over injected deps, so nothing here reaches
// the Docker daemon.

const ROOTS: Record<string, string[]> = {
  PAN: ['/repo/overdeck/workspaces'],
  MIN: ['/repo/myn/workspaces'],
};

function deps(overrides: Partial<OrphanNetworkDeps> = {}): OrphanNetworkDeps {
  return {
    countAttachedContainers: vi.fn(async () => 0),
    workspacesDirsForIssue: (issueId) => ROOTS[issueId.split('-')[0]] ?? [],
    pathExists: () => false,
    activeIssueIds: new Set(),
    ...overrides,
  };
}

function row(name: string, composeProject: string, composeNetwork: string): DockerNetworkRow {
  return { name, composeProject, composeNetwork };
}

describe('orphaned workspace networks (PAN-3900)', () => {
  it('parses name, compose project, and compose network columns', () => {
    expect(parseNetworkRows('bridge\t\t\noverdeck-feature-pan-1_devnet\toverdeck-feature-pan-1\tdevnet\n')).toEqual([
      { name: 'bridge', composeProject: '', composeNetwork: '' },
      { name: 'overdeck-feature-pan-1_devnet', composeProject: 'overdeck-feature-pan-1', composeNetwork: 'devnet' },
    ]);
  });

  it('recognizes workspace, _default, and slot stack networks', () => {
    expect(workspaceNetworkIdentity(row('overdeck-feature-pan-3894_devnet', 'overdeck-feature-pan-3894', 'devnet')))
      .toEqual({ issueId: 'PAN-3894', featureFolder: 'feature-pan-3894' });
    expect(workspaceNetworkIdentity(row('overdeck-feature-pan-3925_default', 'overdeck-feature-pan-3925', 'default')))
      .toEqual({ issueId: 'PAN-3925', featureFolder: 'feature-pan-3925' });
    expect(workspaceNetworkIdentity(row('myn-feature-min-888-slot-3_devnet', 'myn-feature-min-888-slot-3', 'devnet')))
      .toEqual({ issueId: 'MIN-888', featureFolder: 'feature-min-888-slot-3' });
    // No compose network label: the project label prefix still identifies it.
    expect(workspaceNetworkIdentity(row('overdeck-feature-pan-3894_devnet', 'overdeck-feature-pan-3894', '')))
      .toEqual({ issueId: 'PAN-3894', featureFolder: 'feature-pan-3894' });
  });

  it('never claims networks that are not workspace stack networks', () => {
    for (const r of [
      row('bridge', '', ''),
      row('overdeck', '', ''),
      row('panopticon', '', ''),
      row('myn-main_devnet', 'myn-main', 'devnet'),
      // Name looks like a workspace network but carries no compose label.
      row('overdeck-feature-pan-1_devnet', '', ''),
      // Label and name disagree: not compose's own naming.
      row('overdeck-feature-pan-1_devnet', 'overdeck-feature-pan-2', 'devnet'),
      row('overdeck-feature-pan-1_devnet', 'overdeck-feature-pan-2', ''),
      row('overdeck-feature-pan-1_devnet', 'overdeck-feature-pan-1', 'default'),
      row('overdeck-feature-pan-1_', 'overdeck-feature-pan-1', ''),
      row('uat-overdeck-gen-3_devnet', 'uat-overdeck-gen-3', 'devnet'),
    ]) {
      expect(workspaceNetworkIdentity(r)).toBeNull();
    }
  });

  it('reports an unattached workspace network whose directory is gone', async () => {
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('overdeck-feature-pan-3894_devnet', 'overdeck-feature-pan-3894', 'devnet')],
      deps(),
    );
    expect(orphans).toEqual([{
      name: 'overdeck-feature-pan-3894_devnet',
      composeProject: 'overdeck-feature-pan-3894',
      issueId: 'PAN-3894',
      workspacePath: '/repo/overdeck/workspaces/feature-pan-3894',
    }]);
  });

  it('keeps a network whose workspace directory still exists', async () => {
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('overdeck-feature-pan-3921_devnet', 'overdeck-feature-pan-3921', 'devnet')],
      deps({ pathExists: (p) => p === '/repo/overdeck/workspaces/feature-pan-3921' }),
    );
    expect(orphans).toEqual([]);
  });

  it('checks the slot directory, not the base workspace, for slot networks', async () => {
    const exists = vi.fn((p: string) => p === '/repo/myn/workspaces/feature-min-888');
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('myn-feature-min-888-slot-3_devnet', 'myn-feature-min-888-slot-3', 'devnet')],
      deps({ pathExists: exists }),
    );
    expect(exists).toHaveBeenCalledWith('/repo/myn/workspaces/feature-min-888-slot-3');
    expect(orphans.map((o) => o.name)).toEqual(['myn-feature-min-888-slot-3_devnet']);
  });

  it('keeps a network with any attached container, running or stopped', async () => {
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('overdeck-feature-pan-3894_devnet', 'overdeck-feature-pan-3894', 'devnet')],
      deps({ countAttachedContainers: async () => 1 }),
    );
    expect(orphans).toEqual([]);
  });

  it('keeps a network when attachment cannot be determined', async () => {
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('overdeck-feature-pan-3894_devnet', 'overdeck-feature-pan-3894', 'devnet')],
      deps({ countAttachedContainers: async () => { throw new Error('daemon down'); } }),
    );
    expect(orphans).toEqual([]);
  });

  it('keeps a network whose issue prefix belongs to no registered project', async () => {
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('lexerra-feature-lex-5_default', 'lexerra-feature-lex-5', 'default')],
      deps(),
    );
    expect(orphans).toEqual([]);
  });

  it('keeps a network while an agent is active on the issue', async () => {
    const orphans = await selectOrphanedWorkspaceNetworks(
      [row('overdeck-feature-pan-3894_devnet', 'overdeck-feature-pan-3894', 'devnet')],
      deps({ activeIssueIds: new Set(['PAN-3894']) }),
    );
    expect(orphans).toEqual([]);
  });

  it('never asks Docker about networks that fail the name and label checks', async () => {
    const count = vi.fn(async () => 0);
    await selectOrphanedWorkspaceNetworks(
      [row('overdeck', '', ''), row('myn-main_devnet', 'myn-main', 'devnet')],
      deps({ countAttachedContainers: count }),
    );
    expect(count).not.toHaveBeenCalled();
  });
});
