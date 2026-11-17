/**
 * PAN-5464 WI-7: pack groups — the built-in video group, config overrides and config-only groups,
 * read from a temp OVERDECK_HOME's config.yaml.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pack-groups-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { getGlobalConfigPath } from '../../config-yaml/load.js';
import { KNOWN_PACK_GROUPS, listPackGroups, PackGroupError, resolvePackGroup } from '../groups.js';

const writeConfig = (yaml: string): void => writeFileSync(getGlobalConfigPath(), yaml);

beforeEach(() => {
  mkdirSync(overdeckHome, { recursive: true });
  rmSync(getGlobalConfigPath(), { force: true });
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('pack groups', () => {
  it('resolves the built-in video group without a config', async () => {
    expect(await resolvePackGroup('video')).toEqual(['remotion', 'hyperframes', 'openmontage', 'video-use']);
    expect(await listPackGroups()).toEqual([{ name: 'video', packs: KNOWN_PACK_GROUPS['video'], source: 'built-in' }]);
  });

  it('lets a config group replace a built-in of the same name', async () => {
    writeConfig('skills:\n  pack_groups:\n    video: [remotion]\n');
    expect(await resolvePackGroup('video')).toEqual(['remotion']);
    expect(await listPackGroups()).toEqual([{ name: 'video', packs: ['remotion'], source: 'config' }]);
  });

  it('resolves a config-only group and lists groups sorted by name', async () => {
    writeConfig('skills:\n  pack_groups:\n    animation: [remotion, hyperframes]\n');
    expect(await resolvePackGroup('animation')).toEqual(['remotion', 'hyperframes']);
    expect((await listPackGroups()).map((group) => [group.name, group.source])).toEqual([
      ['animation', 'config'],
      ['video', 'built-in'],
    ]);
  });

  it('drops config entries that are not arrays of pack ids', async () => {
    writeConfig('skills:\n  pack_groups:\n    video: remotion\n    bad: [Not_An_Id]\n    mixed: [remotion, 3]\n');
    expect(await resolvePackGroup('video')).toEqual(KNOWN_PACK_GROUPS['video']);
    await expect(resolvePackGroup('bad')).rejects.toThrow(PackGroupError);
    await expect(resolvePackGroup('mixed')).rejects.toThrow(PackGroupError);
  });

  it('rejects an unknown name and names the known groups', async () => {
    await expect(resolvePackGroup('nope')).rejects.toThrow('unknown pack group: nope (known: video)');
  });

  it('falls back to the built-ins when the config does not parse', async () => {
    writeConfig('skills: [unclosed\n');
    expect(await resolvePackGroup('video')).toEqual(KNOWN_PACK_GROUPS['video']);
  });
});
