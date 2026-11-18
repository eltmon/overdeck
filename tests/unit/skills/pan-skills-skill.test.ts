/**
 * PAN-5540 WI-9: the pan-skills bundled skill names every known pack and pack group, so an agent
 * asked for a missing skill learns the pack that holds it. A new KNOWN_PACKS id or built-in group
 * fails this test until the skill lists it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_PACKS } from '../../../src/lib/skill-packs/adapters.js';
import { KNOWN_PACK_GROUPS } from '../../../src/lib/skill-packs/groups.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SKILL = readFileSync(`${ROOT}sync-sources/skills/pan-skills/SKILL.md`, 'utf8');

function frontmatterDescription(text: string): string {
  const match = /^---\n[\s\S]*?^description:\s*"([^"]*)"/m.exec(text);
  return match?.[1] ?? '';
}

describe('pan-skills skill', () => {
  it('names every known pack and pack group', () => {
    for (const id of [...Object.keys(KNOWN_PACKS), ...Object.keys(KNOWN_PACK_GROUPS)]) {
      expect(SKILL, id).toContain(`\`${id}\``);
    }
  });

  it('starts its description with the command and names the video packs', () => {
    const description = frontmatterDescription(SKILL);
    expect(description.startsWith('pan skills')).toBe(true);
    for (const name of ['Remotion', 'HyperFrames', 'OpenMontage', 'video-use']) expect(description).toContain(name);
  });

  it('shows how to find, add, enable and load a pack', () => {
    for (const command of [
      'pan skills pack list --offline',
      'pan skills pack add --group video --yes',
      'pan skills set --group video on',
      'pan skills add self --pack',
    ]) {
      expect(SKILL).toContain(command);
    }
  });
});
