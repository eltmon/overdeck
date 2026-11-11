#!/usr/bin/env node
// PAN-4509: Mintlify renders a pair of `$` on one line as inline LaTeX math, and on a
// line that also contains inline code it does so even for an escaped `\$`. Model
// prices such as "$2/M input, $10/M output" rendered as italic formula glyphs until
// hand-fixed to &#36; in commits 2050875 and bb8ffba — that entity never reaches the
// math parser, so it is the safe spelling for a currency dollar in prose. A bare `<`
// immediately before a digit is a second latent breakage: strict MDX parses `<` as
// the start of a JSX tag and rejects a digit there, so the safe spelling is `&lt;`.
// findMdxProblems below flags both; see docs/RELEASING.md for the author-facing rule.
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DOLLAR_MESSAGE = 'dollar sign in prose renders as math on Mintlify — write &#36; instead';
const LT_DIGIT_MESSAGE = 'bare "<" before a digit breaks strict MDX — write &lt; instead';

// Remove inline code spans: a run of N backticks closes at the next run of exactly N.
export function stripInlineCode(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { out += line[i++]; continue; }
    let n = 0;
    while (line[i + n] === '`') n++;
    const opener = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while ((j = line.indexOf(opener, j)) !== -1) {
      if (line[j + n] !== '`' && line[j - 1] !== '`') { close = j; break; }
      while (line[j] === '`') j++;
    }
    if (close === -1) { out += opener; i += n; continue; }
    i = close + n;
  }
  return out;
}

export function findMdxProblems(content) {
  const problems = [];
  const lines = content.split('\n');
  let fence = null;
  let inFrontmatter = lines[0]?.trim() === '---';
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (inFrontmatter) {
      if (index > 0 && line.trim() === '---') inFrontmatter = false;
      return;
    }
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.length >= fence.length && [...trimmed].every((c) => c === fence[0])) fence = null;
      return;
    }
    const open = /^(`{3,}|~{3,})/.exec(trimmed);
    if (open) { fence = open[1]; return; }
    const prose = stripInlineCode(line);
    if (prose.includes('$')) problems.push({ line: lineNo, message: DOLLAR_MESSAGE });
    if (/<\d/.test(prose)) problems.push({ line: lineNo, message: LT_DIGIT_MESSAGE });
  });
  return problems;
}

const CHANGELOG_SECTIONS = ['New', 'Improved', 'Fixed'];
const CHANGELOG_ENTRY_FILE_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;

// Mirrors parseChangelogEntry in src/lib/release/changelog-fold.ts (PAN-5137); keep
// the rules identical. This plain-JS copy is the PR-time check; the TypeScript
// module is the release-time authority (it cannot be imported from here).
export function findChangelogEntryProblems(fileName, content) {
  const problems = [];
  if (!CHANGELOG_ENTRY_FILE_NAME.test(fileName)) {
    problems.push({ line: 0, message: 'file name must be lowercase kebab-case ending in .md, for example pan-5137.md' });
    return problems;
  }

  const lines = content.split('\n');
  const bulletCounts = new Map();
  let currentSection = null;
  let hasCurrentBullet = false;

  // Checked per bullet/continuation line, not via findMdxProblems(content) on the whole
  // file: findMdxProblems skips fenced code (including an indented fence), but
  // checkMdxSafety in src/lib/release/changelog-fold.ts does not, so a fence-skipping
  // check here would accept an entry that the release-time fold would still reject.
  const checkLineSafety = (line, lineNo) => {
    const prose = stripInlineCode(line);
    if (prose.includes('$')) problems.push({ line: lineNo, message: DOLLAR_MESSAGE });
    if (/<\d/.test(prose)) problems.push({ line: lineNo, message: LT_DIGIT_MESSAGE });
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim() === '') return;

    if (line.startsWith('#')) {
      const section = CHANGELOG_SECTIONS.find((candidate) => line === `#### ${candidate}`);
      if (!section) {
        problems.push({ line: lineNo, message: `unknown heading "${line}"; must be #### New, #### Improved or #### Fixed` });
      } else if (bulletCounts.has(section)) {
        problems.push({ line: lineNo, message: `heading "#### ${section}" appears more than once` });
      } else {
        bulletCounts.set(section, 0);
        currentSection = section;
        hasCurrentBullet = false;
      }
      return;
    }

    if (line.startsWith('- ')) {
      if (currentSection === null) {
        problems.push({ line: lineNo, message: 'bullet appears before any heading' });
        return;
      }
      bulletCounts.set(currentSection, bulletCounts.get(currentSection) + 1);
      hasCurrentBullet = true;
      checkLineSafety(line, lineNo);
      return;
    }

    if (/^ {2,}/.test(line) && hasCurrentBullet) {
      checkLineSafety(line, lineNo);
      return;
    }

    problems.push({
      line: lineNo,
      message: 'line is neither a bullet nor a continuation of one (a bullet starts with "- ", a continuation with 2+ leading spaces)',
    });
  });

  if (bulletCounts.size === 0) {
    problems.push({ line: 0, message: 'has no section headings' });
  }
  for (const [section, count] of bulletCounts) {
    if (count === 0) problems.push({ line: 0, message: `#### ${section} has no bullets` });
  }

  return problems;
}

// Matches "Upcoming" as one element of a tags={[...]} array, single- or double-quoted,
// alongside any other tag values (tags={["Upcoming"]}, tags={['Preview', 'Upcoming']}),
// and description="Unreleased"/'Unreleased'. Independent of quote style, element order,
// or incidental whitespace. Mirrors hasUpcomingBlock in src/lib/release/changelog-fold.ts;
// keep both identical.
const UPCOMING_TAG = /tags\s*=\s*\{\s*\[[^\]]*['"]Upcoming['"][^\]]*\]\s*\}/;
const UNRELEASED_DESCRIPTION = /description\s*=\s*['"]Unreleased['"]/;

export function hasUpcomingBlock(content) {
  return UPCOMING_TAG.test(content) || UNRELEASED_DESCRIPTION.test(content);
}

function checkChangelog(root) {
  let errors = 0;
  let entryCount = 0;

  const changelogPath = join(root, 'changelog.mdx');
  if (existsSync(changelogPath)) {
    const changelog = readFileSync(changelogPath, 'utf-8');
    if (hasUpcomingBlock(changelog)) {
      const lineIndex = changelog.split('\n').findIndex((line) => hasUpcomingBlock(line));
      console.error(
        `changelog.mdx:${lineIndex + 1}: Upcoming/Unreleased block found; put each PR's bullets in changelog.d/<issue>.md (see changelog.d/README.md); pan release stable folds them`,
      );
      errors++;
    }
  }

  const changelogDir = join(root, 'changelog.d');
  if (existsSync(changelogDir)) {
    const names = readdirSync(changelogDir).filter((name) => name !== 'README.md').sort();
    for (const name of names) {
      entryCount++;
      const content = readFileSync(join(changelogDir, name), 'utf-8');
      for (const problem of findChangelogEntryProblems(name, content)) {
        console.error(`changelog.d/${name}:${problem.line}: ${problem.message}`);
        errors++;
      }
    }
  }

  return { errors, entryCount };
}

function checkDocsFiles(docsDir) {
  const files = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
  let errors = 0;
  for (const file of files) {
    const content = readFileSync(join(docsDir, file), 'utf-8');
    if (!content.trim()) {
      console.error(`docs/${file}: empty file`);
      errors++;
    }
    if (!content.endsWith('\n')) {
      console.error(`docs/${file}: file must end with a newline`);
      errors++;
    }
  }
  return { files, errors };
}

// Recursively collect every page path reached under docsJson.navigation through
// tabs, groups and pages arrays. A pages entry may itself be a { group, pages }
// object (a nested group), so pages arrays are walked recursively.
export function collectPublishedPages(docsJson) {
  const pages = [];
  const walkPages = (list) => {
    for (const entry of list ?? []) {
      if (typeof entry === 'string') {
        pages.push(entry);
      } else if (entry && Array.isArray(entry.pages)) {
        walkPages(entry.pages);
      }
    }
  };
  for (const tab of docsJson?.navigation?.tabs ?? []) {
    for (const group of tab.groups ?? []) {
      walkPages(group.pages);
    }
  }
  return pages;
}

function parseArgs(argv) {
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) {
      root = argv[i + 1];
      i++;
    }
  }
  return { root };
}

function checkPublishedPages(root) {
  const docsJson = JSON.parse(readFileSync(join(root, 'docs.json'), 'utf-8'));
  const pages = collectPublishedPages(docsJson);
  let errors = 0;

  for (const page of pages) {
    const mdxPath = join(root, `${page}.mdx`);
    const mdPath = join(root, `${page}.md`);
    const pagePath = existsSync(mdxPath) ? mdxPath : existsSync(mdPath) ? mdPath : null;

    if (!pagePath) {
      console.error(`docs.json lists "${page}" but no ${page}.mdx or ${page}.md exists`);
      errors++;
      continue;
    }

    const content = readFileSync(pagePath, 'utf-8');
    for (const problem of findMdxProblems(content)) {
      console.error(`${relative(root, pagePath)}:${problem.line}: ${problem.message}`);
      errors++;
    }
  }

  return { pages, errors };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { root } = parseArgs(process.argv.slice(2));
  const { files, errors: docsErrors } = checkDocsFiles(join(root, 'docs'));
  const { pages, errors: pageErrors } = checkPublishedPages(root);
  const { errors: changelogErrors, entryCount } = checkChangelog(root);

  if (docsErrors + pageErrors + changelogErrors > 0) {
    process.exit(1);
  }

  console.log(`docs lint passed (${files.length} docs files, ${pages.length} published pages, ${entryCount} changelog entries)`);
}
