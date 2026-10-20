/**
 * PAN-4563 — every committed protocol fixture is parseable, small, and free of
 * home paths, secrets, emails, and unscrubbed oversized strings. This is the
 * backstop behind capture-time scrubbing and the manual review in
 * docs/PROTOCOL-REPLAY-TESTS.md.
 *
 * Secret-shaped inputs are built at runtime: literal fake tokens trip GitHub
 * push protection.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProtocolFixture } from '../fixture.js';
import { EMAIL_PATTERN, SCRUB_MAX_STRING_LENGTH, SECRET_VALUE_PATTERNS } from '../scrub.js';

const MAX_FIXTURE_BYTES = 262_144;
const HOME_PATH = /\/home\/|\/Users\/|\/root\//;
// Fresh, non-global copies: the shared patterns carry the g flag, and .test()
// on a global regex keeps lastIndex between lines.
const SECRET_PATTERNS = SECRET_VALUE_PATTERNS.map(pattern => new RegExp(pattern.source));
const EMAIL = new RegExp(EMAIL_PATTERN.source);

const FIXTURE_DIRS = {
  codex: fileURLToPath(new URL('../../codex/__fixtures__/replay/', import.meta.url)),
  acp: fileURLToPath(new URL('../../acp/__tests__/fixtures/replay/', import.meta.url)),
};
const EXPECTED_FIXTURES = {
  codex: ['approval.jsonl', 'interrupt.jsonl', 'subagent.jsonl', 'turn-idle.jsonl', 'user-input.jsonl'],
  acp: ['kimi-interrupt.jsonl', 'kimi-turn-completion.jsonl'],
};

function oversizedString(value: unknown): boolean {
  if (typeof value === 'string') return value.length > SCRUB_MAX_STRING_LENGTH;
  if (Array.isArray(value)) return value.some(oversizedString);
  if (typeof value === 'object' && value !== null) return Object.values(value).some(oversizedString);
  return false;
}

/** Problems in one fixture's text, each naming the file and 1-based line. */
function hygieneProblems(fileName: string, text: string): string[] {
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const at = `${fileName}:${index + 1}`;
    if (HOME_PATH.test(line)) problems.push(`${at}: absolute home path`);
    if (SECRET_PATTERNS.some(pattern => pattern.test(line))) problems.push(`${at}: secret-shaped value`);
    if (EMAIL.test(line)) problems.push(`${at}: email address`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`${at}: invalid JSON`);
      return;
    }
    if (oversizedString(parsed)) problems.push(`${at}: string longer than ${SCRUB_MAX_STRING_LENGTH} characters`);
    const record = parsed as Record<string, unknown>;
    if (record.type === 'header' && record.synthetic === true) {
      if (typeof record.followUpIssue !== 'string' || !record.followUpIssue) problems.push(`${at}: synthetic fixture without followUpIssue`);
      if (typeof record.syntheticNote !== 'string' || !record.syntheticNote) problems.push(`${at}: synthetic fixture without syntheticNote`);
    }
  });
  return problems;
}

describe('hygieneProblems', () => {
  it('reports each kind of bad line with its file and line number', () => {
    const header = JSON.stringify({ type: 'header', format: 'overdeck-protocol-capture/1', synthetic: true, syntheticNote: 'why' });
    const lines = [
      header,
      JSON.stringify({ text: '/home/dev/project' }),
      JSON.stringify({ text: `key ${'sk-' + 'a'.repeat(24)}` }),
      JSON.stringify({ text: `mail ${'dev' + '@' + 'example.com'}` }),
      JSON.stringify({ text: 'x'.repeat(SCRUB_MAX_STRING_LENGTH + 1) }),
      JSON.stringify({ text: '<HOME>/project <REDACTED> <EMAIL>' }),
    ];
    expect(hygieneProblems('bad.jsonl', lines.join('\n'))).toEqual([
      'bad.jsonl:1: synthetic fixture without followUpIssue',
      'bad.jsonl:2: absolute home path',
      'bad.jsonl:3: secret-shaped value',
      'bad.jsonl:4: email address',
      `bad.jsonl:5: string longer than ${SCRUB_MAX_STRING_LENGTH} characters`,
    ]);
  });
});

describe('committed protocol fixtures', () => {
  it.each(Object.keys(FIXTURE_DIRS) as Array<keyof typeof FIXTURE_DIRS>)('%s: the expected fixture set exists', async (harness) => {
    const names = (await readdir(FIXTURE_DIRS[harness])).filter(name => name.endsWith('.jsonl')).sort();
    expect(names).toEqual(EXPECTED_FIXTURES[harness]);
  });

  const all = Object.entries(EXPECTED_FIXTURES).flatMap(([harness, names]) =>
    names.map(name => ({ harness: harness as keyof typeof FIXTURE_DIRS, name })));

  it.each(all)('$harness/$name parses, fits the size cap, and passes hygiene', async ({ harness, name }) => {
    const path = `${FIXTURE_DIRS[harness]}${name}`;
    const text = await readFile(path, 'utf8');
    expect(() => parseProtocolFixture(text)).not.toThrow();
    expect((await stat(path)).size).toBeLessThanOrEqual(MAX_FIXTURE_BYTES);
    expect(hygieneProblems(name, text)).toEqual([]);
  });
});
