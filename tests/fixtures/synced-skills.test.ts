/**
 * Fixture test for the synced skill set.
 *
 * Locks the set of skills in the skills/ directory so future renames,
 * additions, or deletions are visible in PR diffs. Follows the plain-text
 * fixture convention established by pan-help.test.ts.
 *
 * ## Updating the fixture
 *
 * When the skill set changes intentionally, regenerate the fixture:
 *
 *   UPDATE_FIXTURES=1 npx vitest run tests/fixtures/synced-skills.test.ts
 *
 * The fixture file is tests/fixtures/synced-skills.txt. Review the diff
 * before committing — the test exists so reviewers can eyeball skill surface changes.
 *
 * ## Why plain-text, not .snap files?
 *
 * Vitest snapshot files (.snap) are base64-encoded blobs. Human reviewers
 * cannot read them in PR diffs. Plain-text fixtures produce readable diffs
 * where every changed line is visible.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'synced-skills.txt');
const SKILLS_SOURCE_DIR = join(__dirname, '../../sync-sources/skills');

function captureSkillSet(): string {
  const entries = readdirSync(SKILLS_SOURCE_DIR, { withFileTypes: true });
  const skillNames = entries
    .filter(e => e.isDirectory() && existsSync(join(SKILLS_SOURCE_DIR, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();
  return skillNames.join('\n') + '\n';
}

describe('synced skill set fixture', () => {
  it('matches the committed fixture line-for-line', () => {
    const actual = captureSkillSet();

    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE_PATH, actual, 'utf-8');
      console.log(`Updated ${FIXTURE_PATH}`);
      return;
    }

    const expected = readFileSync(FIXTURE_PATH, 'utf-8');
    expect(actual).toBe(expected);
  });
});
