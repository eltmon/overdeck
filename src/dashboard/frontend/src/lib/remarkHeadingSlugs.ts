/**
 * GitHub-style heading slugs for a Markdown preview (PAN-5337, WI-2).
 *
 * A `#heading` link in a file preview has to match a heading by the same
 * rule GitHub uses, so a link copied from a GitHub-rendered doc still finds
 * its target. `remarkHeadingSlugs` stamps each heading with its slug as a
 * hast property so the renderer can expose it as `data-heading-slug`; no new
 * npm dependency (no `github-slugger`, no `rehype-slug`).
 */

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> } & Record<string, unknown>;
}

const SLUG_STRIP_PATTERN = /[^\p{L}\p{N}\s_-]/gu;
const SLUG_WHITESPACE_PATTERN = /\s/g;

/** The GitHub-style slug for a heading's text: lowercase, punctuation stripped, whitespace dashed. */
export function headingSlug(text: string): string {
  return text.toLowerCase().replace(SLUG_STRIP_PATTERN, '').replace(SLUG_WHITESPACE_PATTERN, '-');
}

function collectHeadingText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return (node.children ?? []).map(collectHeadingText).join('');
}

/** A remark plugin that sets a de-duplicated `data-heading-slug` hast property on every heading. */
export function remarkHeadingSlugs() {
  return (tree: MarkdownNode) => {
    const seen = new Map<string, number>();
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        const base = headingSlug(collectHeadingText(node));
        const occurrence = seen.get(base) ?? 0;
        seen.set(base, occurrence + 1);
        const slug = occurrence === 0 ? base : `${base}-${occurrence}`;
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, 'data-heading-slug': slug } };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
