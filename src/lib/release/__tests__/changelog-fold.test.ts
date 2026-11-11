import { describe, expect, it } from 'vitest';
import {
  type ChangelogEntryFile,
  foldChangelogEntries,
  formatReleaseDate,
  hasUpcomingBlock,
  parseChangelogEntry,
} from '../changelog-fold.js';

const BASE_CHANGELOG = `---
title: "Changelog"
description: "What changed in each Overdeck release."
---

Intro text.

{/* RELEASE STEP comment */}

<Update label="v0.79.0" description="2026-11-11">
  #### Fixed

  - **Prior fix.**

  [Compare v0.78.0...v0.79.0](https://github.com/eltmon/overdeck/compare/v0.78.0...v0.79.0)
</Update>
`;

const UPCOMING_CHANGELOG = `<Update label="v0.80.0" description="Unreleased" tags={["Upcoming"]}>
  #### Fixed

  - **Something.**
</Update>

<Update label="v0.79.0" description="2026-11-11">
</Update>
`;

describe('foldChangelogEntries', () => {
  it('folds entries into a dated block in New, Improved, Fixed order', () => {
    const panOne: ChangelogEntryFile = {
      fileName: 'pan-1.md',
      content: `#### Improved

- **Improved bullet.**
`,
    };
    const panTwo: ChangelogEntryFile = {
      fileName: 'pan-2.md',
      content: `#### Fixed

- **Fixed bullet from pan-2.**
`,
    };
    const panTen: ChangelogEntryFile = {
      fileName: 'pan-10.md',
      content: `#### New

- **New bullet from pan-10.**

#### Fixed

- **Fixed bullet from pan-10.**
`,
    };

    const result = foldChangelogEntries({
      changelog: BASE_CHANGELOG,
      entries: [panTwo, panTen, panOne],
      version: '0.80.0',
      date: '2026-11-12',
    });

    expect(result).toBe(`---
title: "Changelog"
description: "What changed in each Overdeck release."
---

Intro text.

{/* RELEASE STEP comment */}

<Update label="v0.80.0" description="2026-11-12">
  #### New

  - **New bullet from pan-10.**

  #### Improved

  - **Improved bullet.**

  #### Fixed

  - **Fixed bullet from pan-2.**
  - **Fixed bullet from pan-10.**

  [Compare v0.79.0...v0.80.0](https://github.com/eltmon/overdeck/compare/v0.79.0...v0.80.0)
</Update>

<Update label="v0.79.0" description="2026-11-11">
  #### Fixed

  - **Prior fix.**

  [Compare v0.78.0...v0.79.0](https://github.com/eltmon/overdeck/compare/v0.78.0...v0.79.0)
</Update>
`);
  });

  it('keeps multi-line bullets together and indents every line', () => {
    const entry: ChangelogEntryFile = {
      fileName: 'pan-20.md',
      content: `#### New

- **Lead sentence.** More detail on the
  second line of the same bullet.
`,
    };

    const result = foldChangelogEntries({
      changelog: BASE_CHANGELOG,
      entries: [entry],
      version: '0.80.0',
      date: '2026-11-12',
    });

    expect(result).toContain(
      [
        '  #### New',
        '',
        '  - **Lead sentence.** More detail on the',
        '    second line of the same bullet.',
        '',
        '  [Compare v0.79.0...v0.80.0]',
      ].join('\n'),
    );
  });

  it('refuses a changelog that still has an Upcoming block', () => {
    expect(() =>
      foldChangelogEntries({
        changelog: UPCOMING_CHANGELOG,
        entries: [],
        version: '0.80.0',
        date: '2026-11-12',
      }),
    ).toThrow(/Upcoming block/);
  });

  it('refuses an existing block for the target version', () => {
    expect(() =>
      foldChangelogEntries({
        changelog: BASE_CHANGELOG,
        entries: [],
        version: '0.79.0',
        date: '2026-11-12',
      }),
    ).toThrow(/already has a v0\.79\.0 block/);
  });
});

describe('parseChangelogEntry', () => {
  it('rejects an unknown heading', () => {
    expect(() =>
      parseChangelogEntry({ fileName: 'bad.md', content: '#### Changed\n\n- bullet\n' }),
    ).toThrow(/changelog\.d\/bad\.md.*unknown heading/s);
  });

  it('rejects a bullet before any heading', () => {
    expect(() => parseChangelogEntry({ fileName: 'bad.md', content: '- bullet\n' })).toThrow(
      /changelog\.d\/bad\.md.*before any heading/s,
    );
  });

  it('rejects a line that is neither a bullet nor a continuation', () => {
    expect(() =>
      parseChangelogEntry({ fileName: 'bad.md', content: '#### New\n\nstray text\n' }),
    ).toThrow(/changelog\.d\/bad\.md.*neither a bullet nor a continuation/s);
  });

  it('rejects an empty heading', () => {
    expect(() =>
      parseChangelogEntry({
        fileName: 'bad.md',
        content: '#### New\n\n#### Fixed\n\n- bullet\n',
      }),
    ).toThrow(/changelog\.d\/bad\.md.*New has no bullets/s);
  });

  it('rejects a duplicate heading', () => {
    expect(() =>
      parseChangelogEntry({
        fileName: 'bad.md',
        content: '#### New\n\n- bullet\n\n#### New\n\n- bullet2\n',
      }),
    ).toThrow(/changelog\.d\/bad\.md.*more than once/s);
  });

  it('rejects a file with no bullets', () => {
    expect(() => parseChangelogEntry({ fileName: 'bad.md', content: '#### New\n' })).toThrow(
      /changelog\.d\/bad\.md.*New has no bullets/s,
    );
  });

  it('rejects a bullet containing $2', () => {
    expect(() =>
      parseChangelogEntry({ fileName: 'bad.md', content: '#### New\n\n- costs $2 each\n' }),
    ).toThrow(/changelog\.d\/bad\.md.*&#36;/s);
  });

  it('rejects a bullet containing <3', () => {
    expect(() =>
      parseChangelogEntry({ fileName: 'bad.md', content: '#### New\n\n- i love you <3\n' }),
    ).toThrow(/changelog\.d\/bad\.md.*&lt;/s);
  });

  it('accepts $ and <3 inside inline code', () => {
    const parsed = parseChangelogEntry({
      fileName: 'ok.md',
      content: '#### New\n\n- run `$HOME` and `<3`\n',
    });
    expect(parsed.get('New')).toEqual([['- run `$HOME` and `<3`']]);
  });

  it('accepts &#36;2 and &lt;3 in prose', () => {
    const parsed = parseChangelogEntry({
      fileName: 'ok.md',
      content: '#### New\n\n- costs &#36;2 and loves &lt;3\n',
    });
    expect(parsed.get('New')).toEqual([['- costs &#36;2 and loves &lt;3']]);
  });
});

describe('hasUpcomingBlock', () => {
  it('detects the single-quoted form', () => {
    expect(hasUpcomingBlock("<Update label='v0.80.0' description='Unreleased' tags={['Upcoming']}>")).toBe(true);
  });

  it('does not flag a dated release block', () => {
    expect(hasUpcomingBlock('<Update label="v0.79.0" description="2026-11-11">')).toBe(false);
  });
});

describe('formatReleaseDate', () => {
  it('formats a local date, zero-padded', () => {
    expect(formatReleaseDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
