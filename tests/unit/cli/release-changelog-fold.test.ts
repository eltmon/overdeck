import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyChangelogFold, planChangelogFold } from '../../../src/cli/commands/release.js';

const BASE_CHANGELOG = `<Update label="v0.79.0" description="2026-11-11">
  #### Fixed

  - **Prior fix.**

  [Compare v0.78.0...v0.79.0](https://github.com/eltmon/overdeck/compare/v0.78.0...v0.79.0)
</Update>
`;

const UPCOMING_CHANGELOG = `<Update label="v0.80.0" description="Unreleased" tags={["Upcoming"]}>
  #### Fixed

  - **Something.**
</Update>

${BASE_CHANGELOG}`;

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pan-5137-'));
  mkdirSync(join(repoRoot, 'changelog.d'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeChangelog(content: string): void {
  writeFileSync(join(repoRoot, 'changelog.mdx'), content);
}

function writeEntry(name: string, content: string): void {
  writeFileSync(join(repoRoot, 'changelog.d', name), content);
}

describe('planChangelogFold', () => {
  it('skips with no-entries when changelog.d has only README.md', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('README.md', '# changelog.d\n');

    const outcome = planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12));

    expect(outcome).toEqual({ kind: 'skip', reason: 'no-entries', message: 'No changelog.d entries; changelog.mdx unchanged.' });
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
  });

  it('skips with no-entries when changelog.d is missing', () => {
    writeChangelog(BASE_CHANGELOG);
    rmSync(join(repoRoot, 'changelog.d'), { recursive: true, force: true });

    const outcome = planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12));

    expect(outcome).toEqual({ kind: 'skip', reason: 'no-entries', message: 'No changelog.d entries; changelog.mdx unchanged.' });
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
  });

  it('folds two entries, deletes them and keeps README.md', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('README.md', '# changelog.d\n');
    writeEntry('pan-1.md', '#### New\n\n- **First bullet.**\n');
    writeEntry('pan-2.md', '#### Fixed\n\n- **Second bullet.**\n');

    const outcome = planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12));
    expect(outcome.kind).toBe('fold');
    if (outcome.kind !== 'fold') throw new Error('expected fold');

    expect(outcome.plan.content).toContain('<Update label="v0.80.0" description="2026-11-12">');
    expect(outcome.plan.content).toContain('- **First bullet.**');
    expect(outcome.plan.content).toContain('- **Second bullet.**');
    expect(outcome.plan.entries.map((entry) => entry.path).sort()).toEqual(
      [join(repoRoot, 'changelog.d', 'pan-1.md'), join(repoRoot, 'changelog.d', 'pan-2.md')].sort()
    );

    applyChangelogFold(outcome.plan);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(outcome.plan.content);
    expect(() => readFileSync(join(repoRoot, 'changelog.d', 'pan-1.md'), 'utf8')).toThrow();
    expect(() => readFileSync(join(repoRoot, 'changelog.d', 'pan-2.md'), 'utf8')).toThrow();
    expect(readFileSync(join(repoRoot, 'changelog.d', 'README.md'), 'utf8')).toBe('# changelog.d\n');
  });

  it('refuses to apply, and deletes nothing, when an entry changed after planning', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('pan-1.md', '#### New\n\n- **Original bullet.**\n');
    writeEntry('pan-2.md', '#### Fixed\n\n- **Second bullet.**\n');

    const outcome = planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12));
    if (outcome.kind !== 'fold') throw new Error('expected fold');

    // Simulates an operator editing an entry's wording during the minutes-long preflight
    // that runs between planChangelogFold and applyChangelogFold.
    writeEntry('pan-1.md', '#### New\n\n- **Edited after planning.**\n');

    expect(() => applyChangelogFold(outcome.plan)).toThrow(/pan-1\.md changed after planning/);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
    expect(readFileSync(join(repoRoot, 'changelog.d', 'pan-1.md'), 'utf8')).toBe('#### New\n\n- **Edited after planning.**\n');
    expect(readFileSync(join(repoRoot, 'changelog.d', 'pan-2.md'), 'utf8')).toBe('#### Fixed\n\n- **Second bullet.**\n');
  });

  it('throws on a misnamed file and writes nothing', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('Pan-1.md', '#### New\n\n- **Bullet.**\n');

    expect(() => planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12))).toThrow(/Pan-1\.md/);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
    expect(readFileSync(join(repoRoot, 'changelog.d', 'Pan-1.md'), 'utf8')).toBe('#### New\n\n- **Bullet.**\n');
  });

  it('throws on a .mdx entry file and writes nothing', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('pan-2.mdx', '#### New\n\n- **Bullet.**\n');

    expect(() => planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12))).toThrow(/pan-2\.mdx/);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
  });

  it('refuses a leftover Upcoming block with no entries', () => {
    writeChangelog(UPCOMING_CHANGELOG);
    writeEntry('README.md', '# changelog.d\n');

    expect(() => planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12))).toThrow(/Upcoming/);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(UPCOMING_CHANGELOG);
  });

  it('refuses a leftover Upcoming block on a retag with entries', () => {
    const changelogWithBothBlocks = `<Update label="v0.80.0" description="Unreleased" tags={["Upcoming"]}>
  #### Fixed

  - **Something.**
</Update>

<Update label="v0.80.0" description="2026-11-12">
  #### New

  - **Already released.**
</Update>
`;
    writeChangelog(changelogWithBothBlocks);
    writeEntry('pan-1.md', '#### New\n\n- **Bullet.**\n');

    expect(() => planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12))).toThrow(/Upcoming/);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(changelogWithBothBlocks);
  });

  it('refuses an entry containing $2 before any write', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('pan-1.md', '#### New\n\n- costs $2 each\n');

    expect(() => planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12))).toThrow(/&#36;/);
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
    expect(readFileSync(join(repoRoot, 'changelog.d', 'pan-1.md'), 'utf8')).toBe('#### New\n\n- costs $2 each\n');
  });

  it('canary skips even with entries present', () => {
    writeChangelog(BASE_CHANGELOG);
    writeEntry('pan-1.md', '#### New\n\n- **Bullet.**\n');

    const outcome = planChangelogFold(repoRoot, 'canary', '0.80.0-canary.1', new Date(2026, 10, 12));

    expect(outcome.kind).toBe('skip');
    if (outcome.kind !== 'skip') throw new Error('expected skip');
    expect(outcome.reason).toBe('canary');
    expect(readFileSync(join(repoRoot, 'changelog.mdx'), 'utf8')).toBe(BASE_CHANGELOG);
    expect(readFileSync(join(repoRoot, 'changelog.d', 'pan-1.md'), 'utf8')).toBe('#### New\n\n- **Bullet.**\n');
  });

  it('retag skips with block-exists', () => {
    const changelogWithTarget = `<Update label="v0.80.0" description="2026-11-12">
  #### New

  - **Already released.**

  [Compare v0.79.0...v0.80.0](https://github.com/eltmon/overdeck/compare/v0.79.0...v0.80.0)
</Update>

${BASE_CHANGELOG}`;
    writeChangelog(changelogWithTarget);
    writeEntry('pan-1.md', '#### New\n\n- **Bullet.**\n');

    const outcome = planChangelogFold(repoRoot, 'stable', '0.80.0', new Date(2026, 10, 12));

    expect(outcome.kind).toBe('skip');
    if (outcome.kind !== 'skip') throw new Error('expected skip');
    expect(outcome.reason).toBe('block-exists');
    expect(outcome.message).toContain('v0.80.0');
    expect(outcome.message).toContain('1 changelog.d entry');
    expect(readFileSync(join(repoRoot, 'changelog.d', 'pan-1.md'), 'utf8')).toBe('#### New\n\n- **Bullet.**\n');
  });
});
