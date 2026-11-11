// PAN-5137: concurrent PRs no longer share the single Upcoming <Update> block at the
// top of changelog.mdx. Each PR instead drops a changelog.d/<issue>.md entry file, and
// `pan release stable` folds every entry into one dated block (see release.ts). This
// module is pure (no fs, no child_process, no Effect) so the fold logic is unit-testable
// without touching disk; src/cli/commands/release.ts owns the I/O around it.
//
// scripts/lint-docs.js keeps a duplicated validator (plain Node JS, cannot import from
// src/) that enforces the same entry-format rules at PR time; keep the two in sync.

export type ChangelogSection = 'New' | 'Improved' | 'Fixed';
export const CHANGELOG_SECTIONS: readonly ChangelogSection[] = ['New', 'Improved', 'Fixed'];

export interface ChangelogEntryFile {
  fileName: string;
  content: string;
}

/** One parsed entry: section -> bullets, each bullet an array of raw lines. */
export type ParsedChangelogEntry = Map<ChangelogSection, string[][]>;

export class ChangelogEntryError extends Error {
  constructor(
    readonly fileName: string,
    readonly line: number | null,
    message: string,
  ) {
    super(line === null ? `changelog.d/${fileName}: ${message}` : `changelog.d/${fileName}:${line}: ${message}`);
    this.name = 'ChangelogEntryError';
  }
}

export const CHANGELOG_ENTRY_FILE_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;

const DOLLAR_MESSAGE = 'dollar sign in prose renders as math on Mintlify; write &#36; instead';
const LT_DIGIT_MESSAGE = 'bare "<" before a digit breaks strict MDX; write &lt; instead';

// Ported from scripts/lint-docs.js (PAN-4509): remove inline code spans so the dollar
// and bare-"<"-before-a-digit checks below never fire inside `` `code` ``. Keep the two
// copies identical; scripts/lint-docs.js cannot import this TypeScript module.
export function stripInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    const opener = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while ((j = line.indexOf(opener, j)) !== -1) {
      if (line[j + n] !== '`' && line[j - 1] !== '`') {
        close = j;
        break;
      }
      while (line[j] === '`') j++;
    }
    if (close === -1) {
      out += opener;
      i += n;
      continue;
    }
    i = close + n;
  }
  return out;
}

function checkMdxSafety(line: string, fileName: string, lineNo: number): void {
  const prose = stripInlineCode(line);
  if (prose.includes('$')) throw new ChangelogEntryError(fileName, lineNo, DOLLAR_MESSAGE);
  if (/<\d/.test(prose)) throw new ChangelogEntryError(fileName, lineNo, LT_DIGIT_MESSAGE);
}

function headingSection(line: string): ChangelogSection | null {
  for (const section of CHANGELOG_SECTIONS) {
    if (line === `#### ${section}`) return section;
  }
  return null;
}

export function parseChangelogEntry(file: ChangelogEntryFile): ParsedChangelogEntry {
  const { fileName, content } = file;
  const result: ParsedChangelogEntry = new Map();
  const lines = content.split('\n');

  let currentSection: ChangelogSection | null = null;
  let currentBullet: string[] | null = null;

  const finishBullet = (): void => {
    if (currentSection !== null && currentBullet !== null) {
      result.get(currentSection)!.push(currentBullet);
    }
    currentBullet = null;
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim() === '') return;

    if (line.startsWith('#')) {
      finishBullet();
      const section = headingSection(line);
      if (section === null) {
        throw new ChangelogEntryError(fileName, lineNo, `unknown heading "${line}"; must be #### New, #### Improved or #### Fixed`);
      }
      if (result.has(section)) {
        throw new ChangelogEntryError(fileName, lineNo, `heading "#### ${section}" appears more than once`);
      }
      result.set(section, []);
      currentSection = section;
      return;
    }

    if (line.startsWith('- ')) {
      if (currentSection === null) {
        throw new ChangelogEntryError(fileName, lineNo, 'bullet appears before any heading');
      }
      finishBullet();
      checkMdxSafety(line, fileName, lineNo);
      currentBullet = [line];
      return;
    }

    if (/^ {2,}/.test(line) && currentBullet !== null) {
      checkMdxSafety(line, fileName, lineNo);
      currentBullet.push(line);
      return;
    }

    throw new ChangelogEntryError(fileName, lineNo, 'line is neither a bullet nor a continuation of one (a bullet starts with "- ", a continuation with 2+ leading spaces)');
  });

  finishBullet();

  if (result.size === 0) {
    throw new ChangelogEntryError(fileName, null, 'has no section headings');
  }
  for (const [section, bullets] of result) {
    if (bullets.length === 0) {
      throw new ChangelogEntryError(fileName, null, `#### ${section} has no bullets`);
    }
  }

  return result;
}

/** Local YYYY-MM-DD, never toISOString (UTC can be a day ahead on a US evening). */
export function formatReleaseDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Matches "Upcoming" as one element of a tags={[...]} array, single- or double-quoted,
// alongside any other tag values (tags={["Upcoming"]}, tags={['Preview', 'Upcoming']}),
// and description="Unreleased"/'Unreleased'. Independent of quote style, element order,
// or incidental whitespace. Mirrors hasUpcomingBlock in scripts/lint-docs.js; keep both
// identical.
const UPCOMING_TAG = /tags\s*=\s*\{\s*\[[^\]]*['"]Upcoming['"][^\]]*\]\s*\}/;
const UNRELEASED_DESCRIPTION = /description\s*=\s*['"]Unreleased['"]/;

export function hasUpcomingBlock(changelog: string): boolean {
  return UPCOMING_TAG.test(changelog) || UNRELEASED_DESCRIPTION.test(changelog);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Quote-agnostic: a release label may be written with either quote style (the fold
// itself always writes double quotes, but an operator-edited or hand-authored block
// may use single quotes).
export function hasVersionBlock(changelog: string, version: string): boolean {
  return new RegExp(`<Update label=['"]v${escapeRegExp(version)}['"]`).test(changelog);
}

export function foldChangelogEntries(params: {
  changelog: string;
  entries: ChangelogEntryFile[];
  version: string; // "0.80.0", no leading v
  date: string; // "2026-11-12"
}): string {
  const { changelog, entries, version, date } = params;

  if (hasUpcomingBlock(changelog)) {
    throw new Error('changelog.mdx still has an Upcoming block; move its bullets to changelog.d/ first');
  }
  if (hasVersionBlock(changelog, version)) {
    throw new Error(`changelog.mdx already has a v${version} block`);
  }

  const lines = changelog.split('\n');
  const insertIndex = lines.findIndex((line) => line.startsWith('<Update '));
  if (insertIndex === -1) {
    throw new Error('changelog.mdx has no <Update block to insert the new release before');
  }
  const previousLabelMatch = /label=['"](v[^'"]+)['"]/.exec(lines[insertIndex]);
  if (!previousLabelMatch) {
    throw new Error('changelog.mdx <Update block has no label to read the previous version from');
  }
  const previousVersion = previousLabelMatch[1];

  const sortedEntries = [...entries].sort((a, b) => a.fileName.localeCompare(b.fileName, 'en', { numeric: true }));
  const parsedEntries = sortedEntries.map((entry) => parseChangelogEntry(entry));

  const blockLines: string[] = [`<Update label="v${version}" description="${date}">`];
  for (const section of CHANGELOG_SECTIONS) {
    const bullets: string[][] = [];
    for (const parsed of parsedEntries) {
      const sectionBullets = parsed.get(section);
      if (sectionBullets) bullets.push(...sectionBullets);
    }
    if (bullets.length === 0) continue;
    blockLines.push(`  #### ${section}`, '');
    for (const bullet of bullets) {
      for (const line of bullet) blockLines.push(`  ${line}`);
    }
    blockLines.push('');
  }
  blockLines.push(
    `  [Compare ${previousVersion}...v${version}](https://github.com/eltmon/overdeck/compare/${previousVersion}...v${version})`,
    '</Update>',
    '',
  );

  return [...lines.slice(0, insertIndex), ...blockLines, ...lines.slice(insertIndex)].join('\n');
}
