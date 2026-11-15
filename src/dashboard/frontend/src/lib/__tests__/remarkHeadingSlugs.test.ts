import { describe, expect, it } from 'vitest';

import { headingSlug, remarkHeadingSlugs } from '../remarkHeadingSlugs';

interface TestNode {
  type: string;
  value?: string;
  children?: TestNode[];
  data?: { hProperties?: Record<string, unknown> } & Record<string, unknown>;
}

function heading(...children: TestNode[]): TestNode {
  return { type: 'heading', children };
}

function text(value: string): TestNode {
  return { type: 'text', value };
}

function slugOf(node: TestNode): unknown {
  return node.data?.hProperties?.['data-heading-slug'];
}

describe('headingSlug', () => {
  it('slugs punctuation and spaces like GitHub', () => {
    expect(headingSlug('Fort 3D — Supply!')).toBe('fort-3d--supply');
  });

  it('keeps unicode letters', () => {
    expect(headingSlug('Über Café')).toBe('über-café');
  });
});

describe('remarkHeadingSlugs', () => {
  it('de-duplicates repeated headings', () => {
    const tree: TestNode = {
      type: 'root',
      children: [heading(text('Intro')), heading(text('Intro')), heading(text('Intro'))],
    };
    remarkHeadingSlugs()(tree);
    expect(tree.children?.map(slugOf)).toEqual(['intro', 'intro-1', 'intro-2']);
  });

  it('sets hProperties on heading nodes', () => {
    const headingNode = heading(text('Fort 3D'));
    headingNode.data = { hProperties: { id: 'keep-me' } };
    const tree: TestNode = { type: 'root', children: [headingNode] };
    remarkHeadingSlugs()(tree);
    expect(headingNode.data?.hProperties).toEqual({ id: 'keep-me', 'data-heading-slug': 'fort-3d' });
  });

  it('collects text from inlineCode descendants and leaves non-headings alone', () => {
    const codeHeading = heading(text('Run '), { type: 'inlineCode', value: 'pan done' });
    const paragraph: TestNode = { type: 'paragraph', children: [text('not a heading')] };
    const tree: TestNode = { type: 'root', children: [codeHeading, paragraph] };
    remarkHeadingSlugs()(tree);
    expect(slugOf(codeHeading)).toBe('run-pan-done');
    expect(paragraph.data).toBeUndefined();
  });
});
