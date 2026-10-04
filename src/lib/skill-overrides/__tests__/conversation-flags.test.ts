import { describe, expect, it } from 'vitest';
import type { PackCatalogEntry, SkillCatalogEntry } from '../catalog.js';
import { ConversationSkillFlagError, expandConversationSkillFlags, parseSkillFlagList } from '../conversation-flags.js';

const skills: SkillCatalogEntry[] = [{ name: 'grilling', description: 'Grill the plan' }];

function pack(id: string, opts: { cached?: boolean; skills?: Array<{ name: string; optIn: boolean }> } = {}): PackCatalogEntry {
  const cached = opts.cached ?? true;
  return {
    id,
    url: `https://example.com/${id}`,
    ref: 'main',
    commit: 'abc123',
    adapter: 'plain',
    cached,
    manifest: cached
      ? {
          skills: (opts.skills ?? []).map(s => ({ name: s.name, dir: s.name, description: '', optIn: s.optIn })),
          capabilities: {
            hooks: false,
            mcpServers: false,
            commands: false,
            agents: false,
            contextInjection: false,
            gitHooks: false,
            executables: [],
            projectMutatingSkills: [],
            requiresCli: [],
          },
          license: null,
          pluginName: null,
        }
      : null,
  };
}

const mattpocock = pack('mattpocock', {
  skills: [
    { name: 'a', optIn: false },
    { name: 'b', optIn: false },
    { name: 'c', optIn: true },
  ],
});

describe('expandConversationSkillFlags', () => {
  it('expands a cached pack to its non-opt-in skills', () => {
    const result = expandConversationSkillFlags({ skills: [], packs: ['mattpocock'] }, { skills, packs: [mattpocock] });
    expect(result).toEqual({ 'mattpocock/a': true, 'mattpocock/b': true });
  });

  it('rejects an unknown pack and lists the known pack ids', () => {
    expect(() => expandConversationSkillFlags({ skills: [], packs: ['nope'] }, { skills, packs: [mattpocock] }))
      .toThrowError(/^unknown pack: nope\. Known packs: mattpocock$/);
  });

  it('rejects an uncached pack with the pack sync hint', () => {
    const uncached = pack('uncached', { cached: false });
    expect(() => expandConversationSkillFlags({ skills: [], packs: ['uncached'] }, { skills, packs: [uncached] }))
      .toThrowError('pack uncached is not cached; run pan skills pack sync uncached');
  });

  it('accepts a native skill and a pack skill id', () => {
    const result = expandConversationSkillFlags(
      { skills: ['grilling', 'mattpocock/a'], packs: [] },
      { skills, packs: [mattpocock] },
    );
    expect(result).toEqual({ grilling: true, 'mattpocock/a': true });
  });

  it('rejects an unknown skill and lists known skills', () => {
    expect(() => expandConversationSkillFlags({ skills: ['nope'], packs: [] }, { skills, packs: [mattpocock] }))
      .toThrowError(/^unknown skill: nope\. Known skills: grilling, mattpocock\/a, mattpocock\/b, mattpocock\/c$/);
  });

  it('accepts a core skill and stores nothing', () => {
    const result = expandConversationSkillFlags({ skills: ['pan-done'], packs: [] }, { skills, packs: [] });
    expect(result).toEqual({});
  });
});

describe('parseSkillFlagList', () => {
  it('rejects non-arrays and bad ids', () => {
    expect(() => parseSkillFlagList('grilling', 'skills')).toThrowError(ConversationSkillFlagError);
    expect(() => parseSkillFlagList('grilling', 'skills')).toThrowError('Invalid skills');
    expect(() => parseSkillFlagList([1], 'skills')).toThrowError('Invalid skills');
    expect(() => parseSkillFlagList(['bad name'], 'skills')).toThrowError('Invalid skills');
    expect(() => parseSkillFlagList(['bad/name/extra'], 'skills')).toThrowError('Invalid skills');
    expect(() => parseSkillFlagList(['mattpocock/a'], 'packs')).toThrowError('Invalid packs');
    expect(parseSkillFlagList(undefined, 'skills')).toEqual([]);
    expect(parseSkillFlagList(['grilling', 'mattpocock/a'], 'skills')).toEqual(['grilling', 'mattpocock/a']);
    expect(parseSkillFlagList(['mattpocock'], 'packs')).toEqual(['mattpocock']);
  });
});
