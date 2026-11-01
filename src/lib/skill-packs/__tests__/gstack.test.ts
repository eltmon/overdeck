/**
 * PAN-4727 WI-O1, PAN-4730 WI-O1: the gstack skill map and the mounted,
 * opt-in and browser lists.
 */
import { describe, expect, it } from 'vitest';
import {
  GSTACK_BROWSER_OPT_IN_SKILLS,
  GSTACK_BROWSER_SKILLS,
  GSTACK_MOUNTED_SKILLS,
  GSTACK_OPT_IN_SKILLS,
  GSTACK_SKILL_MAP,
  classifyGstackSkill,
  type GstackSkillClass,
} from '../gstack.js';

// PAN-4730 PRD §6, classified against eltmon/gstack@1b778f78: one entry per top-level skill directory.
const EXPECTED: Record<GstackSkillClass, string[]> = {
  default: [
    'context-restore', 'context-save', 'deslop-shared-libs', 'design-motion', 'diagram', 'health', 'investigate',
    'ios-clean', 'ios-design-review', 'ios-fix', 'ios-qa', 'ios-sync', 'landing-report', 'learn', 'plan-ceo-review',
    'plan-devex-review', 'plan-eng-review', 'retro', 'review', 'test-audit', 'verify', 'write-skill',
  ],
  'opt-in': [
    'autoplan', 'benchmark-models', 'captain', 'careful', 'codex', 'cso', 'document-generate', 'document-release',
    'eval-plan', 'freeze', 'guard', 'modernize', 'ubicloud', 'unfreeze',
  ],
  browser: ['benchmark', 'browse', 'devex-review', 'make-pdf', 'qa', 'qa-only', 'scrape', 'skillify', 'spec'],
  'browser-opt-in': [
    'canary', 'design-consultation', 'design-html', 'design-review', 'design-shotgun', 'land-and-deploy',
    'office-hours', 'plan-design-review', 'ship',
  ],
  excluded: [
    'connect-chrome', 'gstack-upgrade', 'plan-tune', 'setup-deploy', 'setup-gbrain', 'sync-gbrain',
    'open-gstack-browser', 'pair-agent', 'setup-browser-cookies',
  ],
};

describe('GSTACK_SKILL_MAP', () => {
  it('classifies every gstack skill at the verified commit, and nothing else', () => {
    for (const [cls, names] of Object.entries(EXPECTED)) {
      for (const name of names) expect({ name, cls: GSTACK_SKILL_MAP[name]?.class }).toEqual({ name, cls });
    }
    expect(Object.keys(GSTACK_SKILL_MAP).sort()).toEqual(Object.values(EXPECTED).flat().sort());
  });

  it('has the five class sizes from the plan', () => {
    const sizes = (cls: GstackSkillClass) => Object.values(GSTACK_SKILL_MAP).filter((e) => e.class === cls).length;
    expect([sizes('default'), sizes('opt-in'), sizes('browser'), sizes('browser-opt-in'), sizes('excluded')]).toEqual([22, 14, 9, 9, 9]);
    expect(Object.keys(GSTACK_SKILL_MAP)).toHaveLength(63);
  });

  it('gives every entry a reason', () => {
    expect(Object.entries(GSTACK_SKILL_MAP).filter(([, e]) => !e.reason.trim())).toEqual([]);
  });
});

describe('mounted and opt-in lists', () => {
  it('mounts default and opt-in skills only, sorted', () => {
    expect(GSTACK_MOUNTED_SKILLS).toEqual([...EXPECTED.default, ...EXPECTED['opt-in']].sort());
    for (const name of [...EXPECTED.excluded, ...EXPECTED.browser, ...EXPECTED['browser-opt-in']]) {
      expect(GSTACK_MOUNTED_SKILLS).not.toContain(name);
    }
  });

  it('lists the opt-in skills, sorted', () => {
    expect(GSTACK_OPT_IN_SKILLS).toEqual([...EXPECTED['opt-in']].sort());
    expect(GSTACK_OPT_IN_SKILLS).toEqual(expect.arrayContaining(['codex', 'careful', 'document-generate']));
  });
});

describe('browser lists', () => {
  it('lists the 18 browser and browser-opt-in skills, sorted', () => {
    expect(GSTACK_BROWSER_SKILLS).toEqual([...EXPECTED.browser, ...EXPECTED['browser-opt-in']].sort());
    expect(GSTACK_BROWSER_SKILLS).toHaveLength(18);
    expect(GSTACK_BROWSER_SKILLS).toEqual(expect.arrayContaining(['qa', 'ship']));
  });

  it('lists the browser-opt-in skills, never a plain browser skill', () => {
    expect(GSTACK_BROWSER_OPT_IN_SKILLS).toEqual(expect.arrayContaining(['ship', 'land-and-deploy', 'canary', 'design-review']));
    expect(GSTACK_BROWSER_OPT_IN_SKILLS).not.toContain('qa');
  });
});

describe('classifyGstackSkill', () => {
  it('returns the map entry for a known skill', () => {
    expect(classifyGstackSkill('qa').class).toBe('browser');
    expect(classifyGstackSkill('ship').class).toBe('browser-opt-in');
    expect(classifyGstackSkill('pair-agent').class).toBe('excluded');
    expect(classifyGstackSkill('review').class).toBe('default');
  });

  it('excludes an unknown skill as unreviewed', () => {
    expect(classifyGstackSkill('new-thing')).toEqual({ class: 'excluded', reason: 'unreviewed' });
    expect(classifyGstackSkill('constructor')).toEqual({ class: 'excluded', reason: 'unreviewed' });
  });
});
