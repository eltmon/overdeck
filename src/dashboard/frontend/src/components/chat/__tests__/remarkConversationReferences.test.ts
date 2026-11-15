import { describe, expect, it } from 'vitest';
import { remarkConversationReferences } from '../remarkConversationReferences';
import type { ConversationRef, ConversationRefMap } from '../../../lib/conversationReferences';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
}

function makeRef(overrides: Partial<ConversationRef> & { key: string; routeKey: string }): ConversationRef {
  return {
    name: overrides.key,
    title: null,
    isCurrent: false,
    conversation: {} as ConversationRef['conversation'],
    ...overrides,
  };
}

function refsOf(...refs: ConversationRef[]): ConversationRefMap {
  return new Map(refs.map((ref) => [ref.key, ref]));
}

function paragraph(children: MarkdownNode[]): MarkdownNode {
  return { type: 'paragraph', children };
}

describe('remarkConversationReferences (PAN-5339 remark-plugin.ac1)', () => {
  it('splits a text node into text/link/text around a resolved reference', () => {
    const refs = refsOf(makeRef({ key: '20261113-6031', routeKey: '3904' }));
    const tree = paragraph([{ type: 'text', value: 'Tell 20261113-6031 now' }]);

    remarkConversationReferences({ refs })(tree);

    expect(tree.children).toEqual([
      { type: 'text', value: 'Tell ' },
      { type: 'link', url: '/conv/3904', title: null, children: [{ type: 'text', value: '20261113-6031' }] },
      { type: 'text', value: ' now' },
    ]);
  });
});

describe('remarkConversationReferences (PAN-5339 remark-plugin.ac2)', () => {
  it('wraps a whole-value inline code span in a link, keeping the inlineCode node as its only child', () => {
    const refs = refsOf(makeRef({ key: '20261113-6031', routeKey: '3904' }));
    const inlineCode: MarkdownNode = { type: 'inlineCode', value: '20261113-6031' };
    const tree = paragraph([inlineCode]);

    remarkConversationReferences({ refs })(tree);

    expect(tree.children).toEqual([
      { type: 'link', url: '/conv/3904', title: null, children: [inlineCode] },
    ]);
  });
});

describe('remarkConversationReferences (PAN-5339 remark-plugin.ac3)', () => {
  const refs = refsOf(
    makeRef({ key: '20261113-6031', routeKey: '3904' }),
    makeRef({ key: '20261115-0001', routeKey: '3905', isCurrent: true }),
  );

  it('leaves a fenced code node untouched', () => {
    const codeNode: MarkdownNode = { type: 'code', value: 'conv 20261113-6031', children: [] };
    const tree: MarkdownNode = { type: 'root', children: [codeNode] };

    remarkConversationReferences({ refs })(tree);

    expect(tree.children).toEqual([codeNode]);
  });

  it('leaves an inline code span holding more than just the reference untouched', () => {
    const inlineCode: MarkdownNode = { type: 'inlineCode', value: 'pan tell 20261113-6031' };
    const tree = paragraph([inlineCode]);

    remarkConversationReferences({ refs })(tree);

    expect(tree.children).toEqual([inlineCode]);
  });

  it('leaves text holding an unknown key as plain text (no link produced)', () => {
    const tree = paragraph([{ type: 'text', value: 'See 20990101-1234 for details' }]);

    remarkConversationReferences({ refs })(tree);

    expect(tree.children?.every((child) => child.type === 'text')).toBe(true);
    expect(tree.children?.map((child) => child.value).join('')).toBe('See 20990101-1234 for details');
  });

  it('leaves text holding the current conversation key untouched', () => {
    const tree = paragraph([{ type: 'text', value: 'conv 3905' }]);

    remarkConversationReferences({ refs: refsOf(makeRef({ key: '3905', routeKey: '3905', isCurrent: true })) })(tree);

    expect(tree.children).toEqual([{ type: 'text', value: 'conv 3905' }]);
  });
});
