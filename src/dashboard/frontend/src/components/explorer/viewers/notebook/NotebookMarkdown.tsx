// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/NotebookPreview.tsx @ 2d8a843e6b
import type { Root, RootContent } from 'mdast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import styles from '../../../CommandDeck/styles/command-deck.module.css';

// Saved notebooks must not load URLs or turn authored links into app actions.
function inertNotebookMarkdown() {
  function clean(nodes: RootContent[]): RootContent[] {
    return nodes.flatMap((node): RootContent[] => {
      if (
        node.type === 'html' ||
        node.type === 'definition' ||
        node.type === 'footnoteReference' ||
        node.type === 'footnoteDefinition'
      )
        return [];
      if (node.type === 'image' || node.type === 'imageReference')
        return [{ type: 'text', value: node.alt ?? '' }];
      if (node.type === 'link' || node.type === 'linkReference') return clean(node.children);
      if (node.type === 'inlineCode') return [{ type: 'text', value: node.value }];
      if (node.type === 'code' && node.lang === 'mermaid') return [{ ...node, lang: 'text' }];
      if ('children' in node) node.children = clean(node.children) as typeof node.children;
      return [node];
    });
  }
  return (tree: Root) => {
    tree.children = clean(tree.children) as Root['children'];
  };
}

const PLUGINS = [remarkGfm, inertNotebookMarkdown];

export function NotebookMarkdown({ text }: { text: string }) {
  return (
    <div className={`${styles.chatMarkdown} px-4 py-3`}>
      <ReactMarkdown remarkPlugins={PLUGINS} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
