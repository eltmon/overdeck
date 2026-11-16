import { describe, expect, it } from 'vitest';

import { splitFrontMatter } from '../frontMatter';

describe('splitFrontMatter (PAN-5427)', () => {
  it('splits the Mission Control fixture into title/description entries and the remaining content', () => {
    const body = [
      '---',
      'title: Mission Control',
      'description: Unified monitoring dashboard for projects, features, and AI agent activity',
      '---',
      '',
      'import { ThemedImage } from "/snippets/themed-image.mdx";',
      '',
      '# Mission Control',
    ].join('\n');

    const { entries, content } = splitFrontMatter(body);

    expect(entries).toEqual([
      { key: 'title', value: 'Mission Control' },
      { key: 'description', value: 'Unified monitoring dashboard for projects, features, and AI agent activity' },
    ]);
    expect(content).toContain('# Mission Control');
    expect(content).not.toContain('title:');
  });

  it('orders entries title, description, then source order regardless of input order', () => {
    const body = ['---', 'description: d', 'title: t', 'icon: i', '---', 'content'].join('\n');

    const { entries } = splitFrontMatter(body);

    expect(entries).toEqual([
      { key: 'title', value: 't' },
      { key: 'description', value: 'd' },
      { key: 'icon', value: 'i' },
    ]);
  });

  it('parses a CRLF body the same as an LF body', () => {
    const lf = ['---', 'title: t', '---', 'content'].join('\n');
    const crlf = ['---', 'title: t', '---', 'content'].join('\r\n');

    expect(splitFrontMatter(crlf).entries).toEqual(splitFrontMatter(lf).entries);
  });

  it('parses a BOM-prefixed body the same as a plain body', () => {
    const plain = ['---', 'title: t', '---', 'content'].join('\n');
    const withBom = '﻿' + plain;

    expect(splitFrontMatter(withBom).entries).toEqual(splitFrontMatter(plain).entries);
  });

  it('returns the body unchanged when there is no closing fence', () => {
    const body = ['---', 'title: x', ''].join('\n');

    expect(splitFrontMatter(body)).toEqual({ entries: [], content: body });
  });

  it('returns the body unchanged when the fenced block has no top-level key line', () => {
    const body = ['---', 'Some prose', '---', 'Text'].join('\n');

    expect(splitFrontMatter(body)).toEqual({ entries: [], content: body });
  });

  it('returns the body unchanged when it does not start with a fence line', () => {
    const body = ['# Heading', '', '---', '', 'text'].join('\n');

    expect(splitFrontMatter(body)).toEqual({ entries: [], content: body });
  });

  it('unquotes double- and single-quoted scalars', () => {
    const body = ['---', 'title: "Quoted: yes"', "name: 'single'", '---', 'content'].join('\n');

    expect(splitFrontMatter(body).entries).toEqual([
      { key: 'title', value: 'Quoted: yes' },
      { key: 'name', value: 'single' },
    ]);
  });

  it('joins a list value as dedented text', () => {
    const body = ['---', 'allowed-tools:', '  - Bash', '  - Read', '---', 'content'].join('\n');

    expect(splitFrontMatter(body).entries).toEqual([{ key: 'allowed-tools', value: '- Bash\n- Read' }]);
  });

  it('keeps the relative indentation of a nested map value', () => {
    const body = ['---', 'hooks:', '  Stop:', '    - matcher: x', '---', 'content'].join('\n');

    expect(splitFrontMatter(body).entries).toEqual([{ key: 'hooks', value: 'Stop:\n  - matcher: x' }]);
  });

  it('joins a block scalar value with dedented lines', () => {
    const body = ['---', 'description: |', '  line one', '  line two', '---', 'content'].join('\n');

    expect(splitFrontMatter(body).entries).toEqual([{ key: 'description', value: 'line one\nline two' }]);
  });

  it('drops a column-0 comment line inside the block', () => {
    const body = ['---', 'title: x', '# note', 'description: y', '---', 'content'].join('\n');

    const { entries } = splitFrontMatter(body);

    expect(entries).toEqual([
      { key: 'title', value: 'x' },
      { key: 'description', value: 'y' },
    ]);
    for (const entry of entries) {
      expect(entry.value).not.toContain('# note');
      expect(entry.key).not.toContain('# note');
    }
  });
});
