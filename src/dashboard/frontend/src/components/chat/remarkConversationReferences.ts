/**
 * remarkConversationReferences (PAN-5339 WI-4/D5).
 *
 * Mirrors `remarkBareFileTextLinks` (ChatMarkdown.tsx): walks the mdast,
 * skipping `code`, `link`, `linkReference` and `definition` nodes. A `text`
 * child is split with `splitConversationReferences`; each segment whose key
 * resolves in `refs` (and isn't the conversation being viewed) becomes a
 * link node around that segment's text. A whole-value `inlineCode` child
 * (its trimmed value resolving via `parseConversationReference`) is
 * replaced with a link node whose only child is the original inlineCode
 * node, so both renderers render `<a><code>…</code></a>`.
 */
import {
  parseConversationReference,
  splitConversationReferences,
  type ConversationRefMap,
} from '../../lib/conversationReferences';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
}

const SKIP_NODE_TYPES = new Set(['code', 'link', 'linkReference', 'definition']);

export function remarkConversationReferences(options: { refs: ConversationRefMap }) {
  const { refs } = options;
  return (tree: MarkdownNode) => {
    if (refs.size === 0) return;

    const visit = (node: MarkdownNode) => {
      if (!node.children || SKIP_NODE_TYPES.has(node.type)) return;

      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value !== undefined) {
          for (const segment of splitConversationReferences(child.value)) {
            const ref = segment.key ? refs.get(segment.key) : undefined;
            children.push(
              ref && !ref.isCurrent
                ? { type: 'link', url: `/conv/${ref.routeKey}`, title: null, children: [{ type: 'text', value: segment.text }] }
                : { type: 'text', value: segment.text },
            );
          }
        } else if (child.type === 'inlineCode' && child.value !== undefined) {
          const key = parseConversationReference(child.value.trim());
          const ref = key ? refs.get(key) : undefined;
          children.push(
            ref && !ref.isCurrent
              ? { type: 'link', url: `/conv/${ref.routeKey}`, title: null, children: [child] }
              : child,
          );
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };

    visit(tree);
  };
}
