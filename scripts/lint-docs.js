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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const docsDir = join(process.cwd(), 'docs');
  const { files, errors } = checkDocsFiles(docsDir);

  if (errors > 0) {
    process.exit(1);
  }

  console.log(`docs lint passed (${files.length} files)`);
}
