/**
 * PAN-5540 WI-1: the known-pack listing — dashboard-addable reasons, CLI add commands, added and
 * missing members per group, and the `pan skills pack list` text lines.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackGroup } from '../groups.js';
import type { PackRegistryEntry } from '../sources.js';

const { listPacks, listPackGroups, addPack } = vi.hoisted(() => ({
  listPacks: vi.fn<() => Promise<PackRegistryEntry[]>>(),
  listPackGroups: vi.fn<() => Promise<PackGroup[]>>(),
  addPack: vi.fn<typeof import('../sources.js').addPack>(),
}));

vi.mock('../sources.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sources.js')>()),
  listPacks,
  addPack,
}));

vi.mock('../groups.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../groups.js')>()),
  listPackGroups,
}));

import { KNOWN_PACKS, notAppliedLabels, type PackManifest } from '../adapters.js';
import { KNOWN_PACK_GROUPS } from '../groups.js';
import {
  addKnownPack,
  formatAvailablePackLines,
  KnownPackError,
  knownPackSource,
  listAvailablePacks,
  notAddableReason,
  packAddCommand,
  previewKnownPack,
  serializePackPreview,
} from '../known.js';
import type { PackPreview } from '../sources.js';

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
  addPack.mockReset();
});

const MANIFEST: PackManifest = {
  skills: [
    { name: 'remotion-best-practices', dir: 'skills/remotion-best-practices', description: 'Remotion rules', optIn: false },
    { name: 'render-setup', dir: 'skills/render-setup', description: 'Writes config', optIn: true },
  ],
  capabilities: {
    hooks: true,
    mcpServers: true,
    commands: false,
    agents: false,
    contextInjection: false,
    gitHooks: false,
    executables: ['skills/render-setup/run.sh'],
    projectMutatingSkills: ['render-setup'],
    requiresCli: [],
  },
  license: 'MIT',
  pluginName: null,
  excluded: [{ name: 'old', reason: 'archived' }],
  mcpServers: {
    zeta: { type: 'http', url: 'https://zeta.example/mcp', headers: {} },
    alpha: { type: 'http', url: 'https://alpha.example/mcp', headers: { 'x-key': 'k' } },
  },
};

const previewFor = (id: string, commit: string): PackPreview => ({
  id,
  url: KNOWN_PACKS[id]?.url ?? '',
  ref: KNOWN_PACKS[id]?.ref ?? '',
  commit,
  adapter: 'plain',
  manifest: MANIFEST,
});

const rejection = async (promise: Promise<unknown>): Promise<KnownPackError> => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(KnownPackError);
  return error as KnownPackError;
};

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

describe('knownPackSource', () => {
  it('refuses a known pack without a default ref, with the CLI message', () => {
    expect(() => knownPackSource('gstack')).toThrow(new KnownPackError('bad-request', 'pack gstack has no default ref; pass --ref <tag-or-branch>'));
  });

  it('lets an explicit ref fill the gap and keeps the default url', () => {
    expect(knownPackSource('gstack', { ref: 'main' })).toEqual({ url: 'https://github.com/eltmon/gstack', ref: 'main' });
  });

  it('refuses an unknown id without a url', () => {
    expect(() => knownPackSource('nope', { ref: 'main' })).toThrow(
      'pack nope has no default url; pass one: pan skills pack add nope <url> --ref <ref>',
    );
  });

  it('prefers explicit values over the defaults', () => {
    expect(knownPackSource('remotion', { url: 'https://example.com/fork', ref: 'v1' })).toEqual({ url: 'https://example.com/fork', ref: 'v1' });
  });
});

describe('previewKnownPack', () => {
  it('refuses a pack whose add runs a build, without fetching', async () => {
    expect((await rejection(previewKnownPack('sageox', []))).code).toBe('not-addable');
    expect(addPack).not.toHaveBeenCalled();
  });

  it('refuses an id outside KNOWN_PACKS, without fetching', async () => {
    expect((await rejection(previewKnownPack('nope', []))).code).toBe('unknown-pack');
    expect((await rejection(previewKnownPack('../etc', []))).code).toBe('unknown-pack');
    expect(addPack).not.toHaveBeenCalled();
  });

  it('fetches the known url and ref and declines the trust step', async () => {
    const preview = previewFor('remotion', COMMIT);
    addPack.mockResolvedValue({ written: false, preview });

    expect(await previewKnownPack('remotion', [])).toBe(preview);
    expect(addPack).toHaveBeenCalledTimes(1);
    const [input, confirm] = addPack.mock.calls[0]!;
    expect(input).toEqual({
      id: 'remotion',
      url: 'https://github.com/eltmon/remotion-skills',
      ref: '3e20ac75161bc34468845df714701cc9bf6075f4',
      reservedIds: [],
    });
    expect(await confirm(preview)).toBe(false);
  });

  it('shares a running preview and refuses an add until it settles', async () => {
    const preview = previewFor('remotion', COMMIT);
    let settle!: (value: { written: boolean; preview: PackPreview }) => void;
    addPack.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));

    const first = previewKnownPack('remotion', []);
    const second = previewKnownPack('remotion', []);
    await vi.waitFor(() => expect(addPack).toHaveBeenCalledTimes(1));
    expect((await rejection(addKnownPack('remotion', COMMIT, []))).code).toBe('busy');

    settle({ written: false, preview });
    expect(await first).toBe(preview);
    expect(await second).toBe(preview);
    expect(addPack).toHaveBeenCalledTimes(1);

    addPack.mockResolvedValueOnce({ written: false, preview });
    await previewKnownPack('remotion', []);
    expect(addPack).toHaveBeenCalledTimes(2);
  });

  it('refuses a preview while an add of the same pack runs', async () => {
    const preview = previewFor('remotion', COMMIT);
    let settle!: (value: { written: boolean; preview: PackPreview }) => void;
    addPack.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));

    const adding = addKnownPack('remotion', COMMIT, []);
    await vi.waitFor(() => expect(addPack).toHaveBeenCalledTimes(1));
    expect((await rejection(previewKnownPack('remotion', []))).code).toBe('busy');
    expect((await rejection(addKnownPack('remotion', COMMIT, []))).code).toBe('busy');

    settle({ written: true, preview });
    expect(await adding).toBe(preview);
  });

  it('runs different packs at the same time', async () => {
    addPack.mockImplementation(async ({ id }) => ({ written: false, preview: previewFor(id, COMMIT) }));
    const [remotion, hyperframes] = await Promise.all([previewKnownPack('remotion', []), previewKnownPack('hyperframes', [])]);
    expect(remotion.id).toBe('remotion');
    expect(hyperframes.id).toBe('hyperframes');
    expect(addPack).toHaveBeenCalledTimes(2);
  });
});

describe('addKnownPack', () => {
  it('trusts only the previewed commit', async () => {
    const preview = previewFor('remotion', COMMIT);
    addPack.mockResolvedValue({ written: true, preview });

    expect(await addKnownPack('remotion', COMMIT, ['pan-done'])).toBe(preview);
    const [input, confirm] = addPack.mock.calls[0]!;
    expect(input).toMatchObject({ id: 'remotion', reservedIds: ['pan-done'] });
    expect(await confirm(previewFor('remotion', COMMIT))).toBe(true);
    expect(await confirm(previewFor('remotion', 'b'.repeat(40)))).toBe(false);
  });

  it('reports commit-changed when the ref now resolves to another commit', async () => {
    addPack.mockResolvedValue({ written: false, preview: previewFor('remotion', 'b'.repeat(40)) });

    const error = await rejection(addKnownPack('remotion', COMMIT, []));
    expect(error.code).toBe('commit-changed');
    expect(error.message).toContain('bbbbbbb');
    expect(error.message).toContain('aaaaaaa');
  });

  it('refuses a pack the dashboard cannot add', async () => {
    expect((await rejection(addKnownPack('gstack', COMMIT, []))).code).toBe('not-addable');
    expect(addPack).not.toHaveBeenCalled();
  });
});

describe('serializePackPreview', () => {
  it('maps the preview rows the add dialog shows', () => {
    const dto = serializePackPreview({ ...previewFor('video-use', COMMIT), pluginRoot: 'plugin' });

    expect(dto).toEqual({
      id: 'video-use',
      url: KNOWN_PACKS['video-use']?.url,
      ref: KNOWN_PACKS['video-use']?.ref,
      commit: COMMIT,
      adapter: 'plain',
      pluginRoot: 'plugin',
      license: 'MIT',
      skills: [
        { name: 'remotion-best-practices', description: 'Remotion rules', optIn: false },
        { name: 'render-setup', description: 'Writes config', optIn: true },
      ],
      excluded: [{ name: 'old', reason: 'archived' }],
      notApplied: notAppliedLabels(MANIFEST.capabilities),
      executables: ['skills/render-setup/run.sh'],
      mcpServers: [
        { name: 'alpha', url: 'https://alpha.example/mcp' },
        { name: 'zeta', url: 'https://zeta.example/mcp' },
      ],
      disclosure: KNOWN_PACKS['video-use']?.disclosure,
    });
  });

  it('reports no root, no exclusions and no MCP servers when the manifest has none', () => {
    const { excluded: _excluded, mcpServers: _mcp, ...bare } = MANIFEST;
    const dto = serializePackPreview({ ...previewFor('pstack', COMMIT), manifest: { ...bare, license: null } });
    expect(dto).toMatchObject({ pluginRoot: null, license: null, excluded: [], mcpServers: [], disclosure: null });
  });
});
