import { describe, expect, it } from 'vitest';

import {
  adfToMarkdown,
  markdownToAdf,
  markdownToWiki,
  wikiToMarkdown,
} from '../../../../src/lib/tracker/jira-text.js';

const text = (value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) =>
  (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

// One document with every CP-2 node and mark type.
const everyNodeDoc = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Overview')] },
    para(
      text('bold', [{ type: 'strong' }]), text(' '),
      text('italic', [{ type: 'em' }]), text(' '),
      text('mono', [{ type: 'code' }]), text(' '),
      text('gone', [{ type: 'strike' }]), text(' '),
      text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      { type: 'hardBreak' },
      { type: 'mention', attrs: { id: 'abc', text: '@Ada Lovelace' } }, text(' '),
      { type: 'emoji', attrs: { shortName: ':smile:', text: '😄' } }, text(' '),
      { type: 'inlineCard', attrs: { url: 'https://jira.example.com/browse/PROJ-2' } },
    ),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para(text('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('nested'))] }] }] },
        { type: 'listItem', content: [para(text('two'))] },
      ],
    },
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [para(text('first'))] },
        { type: 'listItem', content: [para(text('second'))] },
      ],
    },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1;\nconst y = 2;')] },
    { type: 'blockquote', content: [para(text('quoted'))] },
    { type: 'rule' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para(text('Key'))] }, { type: 'tableHeader', content: [para(text('Value'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [para(text('a|b'))] }, { type: 'tableCell', content: [para(text('1'))] }] },
      ],
    },
    { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm1', type: 'file', collection: 'c' } }] },
  ],
};

const everyNodeMarkdown = [
  '## Overview',
  '**bold** *italic* `mono` ~~gone~~ [site](https://example.com)',
  '@Ada Lovelace 😄 https://jira.example.com/browse/PROJ-2',
  '',
  '- one',
  '  - nested',
  '- two',
  '',
  '1. first',
  '2. second',
  '```ts',
  'const x = 1;',
  'const y = 2;',
  '```',
  '> quoted',
  '',
  '---',
  '| Key | Value |',
  '| --- | --- |',
  '| a\\|b | 1 |',
  '',
  '[attachment]',
].join('\n');

const sample = [
  '# Release plan',
  '- **ship** the `jira` adapter',
  '- read [the docs](https://example.com)',
  '```ts',
  'const ok = true;',
  '```',
].join('\n');

describe('adfToMarkdown', () => {
  it('renders every CP-2 node type (golden)', () => {
    expect(adfToMarkdown(everyNodeDoc)).toBe(everyNodeMarkdown);
  });

  it('renders the text of an unknown node and does not throw', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [{ type: 'panel', attrs: { panelType: 'info' }, content: [para(text('inside a panel'))] }, { type: 'mystery', content: [text('loose text')] }],
    };
    expect(adfToMarkdown(doc)).toBe('inside a panel\n\nloose text');
  });

  it('returns an empty string for non-object input', () => {
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown('plain')).toBe('');
    expect(adfToMarkdown(42)).toBe('');
  });
});

describe('markdownToAdf', () => {
  it('builds headings, lists, code blocks and links', () => {
    expect(markdownToAdf(sample)).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Release plan')] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para(text('ship', [{ type: 'strong' }]), text(' the '), text('jira', [{ type: 'code' }]), text(' adapter'))] },
            { type: 'listItem', content: [para(text('read '), text('the docs', [{ type: 'link', attrs: { href: 'https://example.com' } }]))] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const ok = true;')] },
      ],
    });
  });

  it('always returns at least one paragraph', () => {
    expect(markdownToAdf('')).toEqual({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
  });

  it('links bare URLs and keeps snake_case words plain', () => {
    const doc = markdownToAdf('see https://example.com/a for my_var_name');
    expect(doc.content[0].content).toEqual([
      text('see '),
      text('https://example.com/a', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]),
      text(' for my_var_name'),
    ]);
  });

  it('round-trips the sample through adfToMarkdown', () => {
    expect(adfToMarkdown(markdownToAdf(sample))).toBe(sample);
  });
});

describe('wiki markup', () => {
  it('converts the sample to wiki markup', () => {
    expect(markdownToWiki(sample)).toBe([
      'h1. Release plan',
      '* *ship* the {{jira}} adapter',
      '* read [the docs|https://example.com]',
      '{code:ts}',
      'const ok = true;',
      '{code}',
    ].join('\n'));
  });

  it('round-trips the sample through markdownToWiki and wikiToMarkdown', () => {
    expect(wikiToMarkdown(markdownToWiki(sample))).toBe(sample);
  });

  it('converts headings, marks, links, lists, code and tables from wiki markup', () => {
    const wiki = [
      'h3. Notes',
      '*bold* _italic_ {{mono}} -gone- [text|https://example.com] [https://example.com/raw]',
      '* top',
      '** nested',
      '# first',
      '# second',
      '{noformat}',
      'raw *text*',
      '{noformat}',
      '||Key||Value||',
      '|a|1|',
      'plain line',
    ].join('\n');
    expect(wikiToMarkdown(wiki)).toBe([
      '### Notes',
      '**bold** *italic* `mono` ~~gone~~ [text](https://example.com) https://example.com/raw',
      '- top',
      '  - nested',
      '1. first',
      '2. second',
      '```',
      'raw *text*',
      '```',
      '| Key | Value |',
      '| --- | --- |',
      '| a | 1 |',
      'plain line',
    ].join('\n'));
  });

  it('converts a single-line code macro', () => {
    expect(wikiToMarkdown('{code:java}int x = 1;{code}')).toBe('```java\nint x = 1;\n```');
  });
});
