import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectPublishedPages,
  findChangelogEntryProblems,
  findMdxProblems,
  hasUpcomingBlock,
  stripInlineCode,
} from '../../../scripts/lint-docs.js';

const DOLLAR = '&#36;';
const LT = '&lt;';

const SCRIPT = fileURLToPath(new URL('../../../scripts/lint-docs.js', import.meta.url));

describe('findMdxProblems', () => {
  it('flags a dollar sign in prose', () => {
    const problems = findMdxProblems('Price: $2/M input');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 1 });
    expect(problems[0].message).toContain(DOLLAR);
  });

  it('flags an escaped dollar sign in prose', () => {
    const problems = findMdxProblems('Price: \\$2/M input');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(DOLLAR);
  });

  it('flags a single dollar amount', () => {
    const problems = findMdxProblems('- **Total spend:** $54,116');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(DOLLAR);
  });

  it('does not flag the &#36; numeric entity', () => {
    expect(findMdxProblems('Price: &#36;2/M input')).toEqual([]);
  });

  it('does not flag $ inside a single-backtick inline code span', () => {
    expect(findMdxProblems('Set `$HOME` before running.')).toEqual([]);
  });

  it('does not flag $ inside a double-backtick inline code span', () => {
    expect(findMdxProblems('Use ``a $ b`` here.')).toEqual([]);
  });

  it('flags a prose $ on a line that also has inline code', () => {
    const problems = findMdxProblems('Run `npm i` — costs $2/M input');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(DOLLAR);
  });

  it('does not flag $ inside a backtick fence', () => {
    const content = ['```bash', '$ npm i', '```'].join('\n');
    expect(findMdxProblems(content)).toEqual([]);
  });

  it('does not flag $ inside a fence indented inside <Steps>', () => {
    const content = ['  ```bash', '  $ npm i', '  ```'].join('\n');
    expect(findMdxProblems(content)).toEqual([]);
  });

  it('does not flag $ inside a tilde fence', () => {
    const content = ['~~~', '$ npm i', '~~~'].join('\n');
    expect(findMdxProblems(content)).toEqual([]);
  });

  it('does not flag $ in a frontmatter description', () => {
    const content = ['---', 'description: "$5"', '---', 'Body text.'].join('\n');
    expect(findMdxProblems(content)).toEqual([]);
  });

  it('flags a bare "<" before a digit', () => {
    const problems = findMdxProblems('Retries: <3 retries');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(LT);
  });

  it('does not flag the &lt; entity', () => {
    expect(findMdxProblems('Retries: &lt;3')).toEqual([]);
  });

  it('does not flag "<" separated from a digit by whitespace', () => {
    expect(findMdxProblems('a < 3')).toEqual([]);
  });

  it('reports correct 1-based line numbers across multi-line content', () => {
    const content = ['line one', 'Price: $2/M', 'line three', 'Retries: <3'].join('\n');
    const problems = findMdxProblems(content);
    expect(problems).toHaveLength(2);
    expect(problems[0].line).toBe(2);
    expect(problems[0].message).toContain(DOLLAR);
    expect(problems[1].line).toBe(4);
    expect(problems[1].message).toContain(LT);
  });
});

describe('stripInlineCode', () => {
  it('removes a single-backtick span', () => {
    expect(stripInlineCode('Set `$HOME` now')).not.toContain('$');
  });

  it('removes a double-backtick span containing a single backtick and a dollar sign', () => {
    expect(stripInlineCode('Use ``a ` $ b`` here')).not.toContain('$');
  });

  it('leaves an unmatched backtick run as literal text', () => {
    expect(stripInlineCode('oops ` unmatched')).toContain('`');
  });
});

describe('findChangelogEntryProblems', () => {
  it('returns no problems for a valid two-section entry', () => {
    const content = '#### New\n\n- **Bullet one.**\n\n#### Fixed\n\n- **Bullet two.**\n';
    expect(findChangelogEntryProblems('pan-1.md', content)).toEqual([]);
  });

  it('rejects a misnamed file', () => {
    const problems = findChangelogEntryProblems('Pan-1.md', '#### New\n\n- bullet\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 0 });
    expect(problems[0].message).toContain('kebab-case');
  });

  it('rejects an unknown heading', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### Changed\n\n- bullet\n');
    expect(problems.some((p) => p.message.includes('unknown heading'))).toBe(true);
  });

  it('rejects a bullet before any heading', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '- bullet\n');
    expect(problems.some((p) => p.message.includes('before any heading'))).toBe(true);
  });

  it('rejects a line that is neither a bullet nor a continuation', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### New\n\nstray text\n');
    expect(problems.some((p) => p.message.includes('neither a bullet nor a continuation'))).toBe(true);
  });

  it('rejects an empty heading', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### New\n\n#### Fixed\n\n- bullet\n');
    expect(problems.some((p) => p.message.includes('New has no bullets'))).toBe(true);
  });

  it('rejects a duplicate heading', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### New\n\n- bullet\n\n#### New\n\n- bullet2\n');
    expect(problems.some((p) => p.message.includes('more than once'))).toBe(true);
  });

  it('rejects a file with no bullets', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### New\n');
    expect(problems.some((p) => p.message.includes('New has no bullets'))).toBe(true);
  });

  it('returns the dollar-sign message for a bullet containing $2', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### New\n\n- costs $2 each\n');
    expect(problems.some((p) => p.message.includes(DOLLAR))).toBe(true);
  });

  it('returns the lt-digit message for a bullet containing <3', () => {
    const problems = findChangelogEntryProblems('pan-1.md', '#### New\n\n- i love you <3\n');
    expect(problems.some((p) => p.message.includes(LT))).toBe(true);
  });

  it('rejects a dollar sign inside an indented fence under a bullet', () => {
    const content = '#### Fixed\n\n- bullet\n  ~~~\n  $2\n  ~~~\n';
    const problems = findChangelogEntryProblems('pan-1.md', content);
    expect(problems.some((p) => p.message.includes(DOLLAR))).toBe(true);
  });
});

describe('hasUpcomingBlock', () => {
  it('detects the double-quoted form', () => {
    expect(hasUpcomingBlock('<Update label="v0.80.0" description="Unreleased" tags={["Upcoming"]}>')).toBe(true);
  });

  it('detects the single-quoted form', () => {
    expect(hasUpcomingBlock("<Update label='v0.80.0' description='Unreleased' tags={['Upcoming']}>")).toBe(true);
  });

  it('does not flag a dated release block', () => {
    expect(hasUpcomingBlock('<Update label="v0.79.0" description="2026-11-11">')).toBe(false);
  });
});

describe('collectPublishedPages', () => {
  it('flattens a nested { group, pages } object inside a pages array', () => {
    const docsJson = {
      navigation: {
        tabs: [
          {
            tab: 'Guides',
            groups: [
              {
                group: 'Guides',
                pages: ['top-level', { group: 'Nested', pages: ['nested-one', 'nested-two'] }],
              },
            ],
          },
        ],
      },
    };

    expect(collectPublishedPages(docsJson)).toEqual(['top-level', 'nested-one', 'nested-two']);
  });
});

describe('lint-docs CLI', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'lint-docs-'));
    roots.push(root);
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'ok.md'), 'Some docs content.\n');
    return root;
  }

  function writeDocsJson(root: string, pages: unknown[]): void {
    writeFileSync(
      join(root, 'docs.json'),
      JSON.stringify({ navigation: { tabs: [{ tab: 'T', groups: [{ group: 'G', pages }] }] } }),
    );
  }

  function run(root: string): { ok: boolean; output: string } {
    try {
      const output = execFileSync('node', [SCRIPT, '--root', root], { encoding: 'utf-8' });
      return { ok: true, output };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string };
      return { ok: false, output: [error.stdout ?? '', error.stderr ?? ''].join('\n') };
    }
  }

  it('fails and names the file and line when a published page has a currency dollar in prose', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'bad.mdx'), 'line one\nline two\nPrice: $2/M\n');
    writeDocsJson(root, ['bad']);

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('bad.mdx:3:');
    expect(output).toContain(DOLLAR);
  });

  it('passes on a clean fixture', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'good.mdx'), `Price: ${DOLLAR}2/M\n`);
    writeDocsJson(root, ['good']);

    const { ok, output } = run(root);

    expect(ok).toBe(true);
    expect(output).toContain('docs lint passed');
  });

  it('fails and names a page listed in docs.json with no matching file', () => {
    const root = makeRoot();
    writeDocsJson(root, ['missing']);

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('missing');
  });

  it('fails with Upcoming/Unreleased block found when changelog.mdx has an Upcoming block', () => {
    const root = makeRoot();
    writeDocsJson(root, []);
    writeFileSync(
      join(root, 'changelog.mdx'),
      '<Update label="v0.80.0" description="Unreleased" tags={["Upcoming"]}>\n  #### Fixed\n\n  - bullet\n</Update>\n',
    );

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('Upcoming/Unreleased block found');
    expect(output).toContain('changelog.d/<issue>.md');
  });

  it('fails with Upcoming/Unreleased block found for a single-quoted Update opener', () => {
    const root = makeRoot();
    writeDocsJson(root, []);
    writeFileSync(
      join(root, 'changelog.mdx'),
      "<Update label='v0.80.0' description='Unreleased' tags={['Upcoming']}>\n  #### Fixed\n\n  - bullet\n</Update>\n",
    );

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('Upcoming/Unreleased block found');
  });

  it('fails and names the offending changelog.d entry', () => {
    const root = makeRoot();
    writeDocsJson(root, []);
    writeFileSync(join(root, 'changelog.mdx'), 'No update blocks here.\n');
    mkdirSync(join(root, 'changelog.d'));
    writeFileSync(join(root, 'changelog.d', 'pan-1.md'), '#### Changed\n\n- bullet\n');

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('changelog.d/pan-1.md');
  });

  it('passes with a valid entry plus README.md, and does not validate README.md as an entry', () => {
    const root = makeRoot();
    writeDocsJson(root, []);
    writeFileSync(join(root, 'changelog.mdx'), 'No update blocks here.\n');
    mkdirSync(join(root, 'changelog.d'));
    writeFileSync(join(root, 'changelog.d', 'README.md'), '# changelog.d\n\nNot a valid entry heading.\n');
    writeFileSync(join(root, 'changelog.d', 'pan-1.md'), '#### New\n\n- **Bullet.**\n');

    const { ok, output } = run(root);

    expect(ok).toBe(true);
    expect(output).toContain('1 changelog entries');
  });
});
