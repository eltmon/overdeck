/**
 * PAN-5540 WI-1: the known-pack listing — dashboard-addable reasons, CLI add commands, added and
 * missing members per group, and the `pan skills pack list` text lines.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackGroup } from '../groups.js';
import type { PackRegistryEntry } from '../sources.js';

const { listPacks, listPackGroups } = vi.hoisted(() => ({
  listPacks: vi.fn<() => Promise<PackRegistryEntry[]>>(),
  listPackGroups: vi.fn<() => Promise<PackGroup[]>>(),
}));

vi.mock('../sources.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sources.js')>()),
  listPacks,
}));

vi.mock('../groups.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../groups.js')>()),
  listPackGroups,
}));

import { KNOWN_PACKS } from '../adapters.js';
import { KNOWN_PACK_GROUPS } from '../groups.js';
import { formatAvailablePackLines, listAvailablePacks, notAddableReason, packAddCommand } from '../known.js';

const COMMIT = 'a'.repeat(40);
const BUILT_IN_GROUPS: PackGroup[] = Object.entries(KNOWN_PACK_GROUPS).map(([name, packs]) => ({
  name,
  packs,
  source: 'built-in',
}));

const registered = (...ids: string[]): PackRegistryEntry[] =>
  ids.map((id) => ({ id, url: `https://example.com/${id}`, ref: 'main', commit: COMMIT }));

beforeEach(() => {
  listPacks.mockReset().mockResolvedValue([]);
  listPackGroups.mockReset().mockResolvedValue(BUILT_IN_GROUPS);
});

describe('notAddableReason', () => {
  it('lets the dashboard add packs with a default ref and no build step', () => {
    for (const id of ['remotion', 'hyperframes', 'openmontage', 'video-use', 'pstack', 'atlassian']) {
      expect(notAddableReason(id), id).toBeNull();
    }
  });

  it('needs a ref for packs without a default ref and for unknown ids', () => {
    for (const id of ['mattpocock', 'deft', 'gstack', 'nope']) {
      expect(notAddableReason(id), id).toBe('needs-ref');
    }
  });

  it('refuses sageox because adding it builds ox', () => {
    expect(notAddableReason('sageox')).toBe('runs-build');
  });
});

describe('packAddCommand', () => {
  it('omits --ref when the known pack defaults it', () => {
    expect(packAddCommand('remotion')).toBe('pan skills pack add remotion');
  });

  it('asks for --ref when the known pack has no default', () => {
    expect(packAddCommand('gstack')).toBe('pan skills pack add gstack --ref <ref>');
  });
});

describe('listAvailablePacks', () => {
  it('lists every known pack as not added and the whole video group as missing on a fresh machine', async () => {
    const listing = await listAvailablePacks();

    expect(listing.packs.map((pack) => pack.id)).toEqual(Object.keys(KNOWN_PACKS).sort((a, b) => a.localeCompare(b)));
    expect(listing.packs).toHaveLength(10);
    expect(listing.packs.every((pack) => !pack.added)).toBe(true);

    const video = listing.groups.find((group) => group.name === 'video');
    expect(video).toEqual({
      name: 'video',
      packs: ['remotion', 'hyperframes', 'openmontage', 'video-use'],
      source: 'built-in',
      missing: ['remotion', 'hyperframes', 'openmontage', 'video-use'],
      unknown: [],
      dashboardAddable: true,
      addCommand: 'pan skills pack add --group video',
    });

    const remotion = listing.packs.find((pack) => pack.id === 'remotion');
    expect(remotion).toMatchObject({
      url: 'https://github.com/eltmon/remotion-skills',
      ref: KNOWN_PACKS['remotion']?.ref,
      adapter: 'plain',
      dashboardAddable: true,
      reason: null,
      addCommand: 'pan skills pack add remotion',
      groups: ['video'],
    });

    const gstack = listing.packs.find((pack) => pack.id === 'gstack');
    expect(gstack).toMatchObject({ ref: null, dashboardAddable: false, reason: 'needs-ref', groups: [] });
  });

  it('reports only unregistered members as missing', async () => {
    listPacks.mockResolvedValue(registered('remotion', 'hyperframes'));
    const listing = await listAvailablePacks();

    expect(listing.groups.find((group) => group.name === 'video')?.missing).toEqual(['openmontage', 'video-use']);
    expect(listing.packs.find((pack) => pack.id === 'remotion')?.added).toBe(true);
    expect(listing.packs.find((pack) => pack.id === 'openmontage')?.added).toBe(false);
  });

  it('marks a config group with a member outside KNOWN_PACKS as not dashboard-addable', async () => {
    listPackGroups.mockResolvedValue([...BUILT_IN_GROUPS, { name: 'mine', packs: ['remotion', 'custom-x'], source: 'config' }]);
    const listing = await listAvailablePacks();

    const mine = listing.groups.find((group) => group.name === 'mine');
    expect(mine).toMatchObject({ missing: ['remotion', 'custom-x'], unknown: ['custom-x'], dashboardAddable: false });
    expect(listing.packs.find((pack) => pack.id === 'remotion')?.groups).toEqual(['mine', 'video']);
  });

  it('marks a group whose missing member needs a ref as not dashboard-addable', async () => {
    listPackGroups.mockResolvedValue([{ name: 'tools', packs: ['remotion', 'gstack'], source: 'config' }]);
    const listing = await listAvailablePacks();

    expect(listing.groups[0]).toMatchObject({ missing: ['remotion', 'gstack'], unknown: [], dashboardAddable: false });
  });

  it('marks a group with no missing members as not dashboard-addable', async () => {
    listPacks.mockResolvedValue(registered('remotion', 'hyperframes', 'openmontage', 'video-use'));
    const listing = await listAvailablePacks();

    expect(listing.groups.find((group) => group.name === 'video')).toMatchObject({ missing: [], dashboardAddable: false });
  });
});

describe('formatAvailablePackLines', () => {
  it('prints the not-added known packs with their add commands, then the groups with missing members', async () => {
    const lines = formatAvailablePackLines(await listAvailablePacks());
    const width = Math.max(...Object.keys(KNOWN_PACKS).map((id) => id.length));

    expect(lines[0]).toBe('Known packs not added (10)');
    expect(lines).toContain(`${'video-use'.padEnd(width)}  pan skills pack add video-use`);
    expect(lines).toContain(`${'gstack'.padEnd(width)}  pan skills pack add gstack --ref <ref>`);
    expect(lines).toContain('');
    expect(lines).toContain('Groups');
    expect(lines).toContain('video  remotion, hyperframes, openmontage, video-use  (built-in)');
    expect(lines).toContain('  not added: remotion, hyperframes, openmontage, video-use; run pan skills pack add --group video');
  });

  it('omits the known-packs section when every known pack is added', async () => {
    listPacks.mockResolvedValue(registered(...Object.keys(KNOWN_PACKS)));
    const lines = formatAvailablePackLines(await listAvailablePacks());

    expect(lines.some((line) => line.startsWith('Known packs not added'))).toBe(false);
    expect(lines).toEqual(['Groups', 'video  remotion, hyperframes, openmontage, video-use  (built-in)']);
  });

  it('names unknown members of a config group', async () => {
    listPacks.mockResolvedValue(registered(...Object.keys(KNOWN_PACKS)));
    listPackGroups.mockResolvedValue([{ name: 'mine', packs: ['remotion', 'custom-x'], source: 'config' }]);
    const lines = formatAvailablePackLines(await listAvailablePacks());

    expect(lines).toEqual([
      'Groups',
      'mine  remotion, custom-x  (config)',
      '  not added: custom-x; run pan skills pack add --group mine',
      '  not known packs: custom-x; add each with pan skills pack add <id> <url> --ref <ref>',
    ]);
  });

  it('omits the Groups header when there are no groups', async () => {
    listPackGroups.mockResolvedValue([]);
    const lines = formatAvailablePackLines(await listAvailablePacks());

    expect(lines).not.toContain('Groups');
    expect(lines.at(-1)).not.toBe('');
  });
});
