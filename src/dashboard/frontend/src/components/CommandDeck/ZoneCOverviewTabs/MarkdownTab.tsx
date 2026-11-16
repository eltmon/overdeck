/**
 * MarkdownTab — renders a markdown body via ChatMarkdown with empty/loading states.
 *
 * Used for PRD / STATE / INFERENCE tabs, the code pane Preview and the editor
 * pane Preview. An optional `docLocation` (PAN-5337) names the explorer root
 * and root-relative path the body came from, so ChatMarkdown can resolve its
 * document-relative links; the Docs pane and the cockpit dig tabs pass none,
 * so their relative links stay inert. A located preview renders through
 * ReactMarkdown rather than Streamdown (D11), since Streamdown's
 * rehype-sanitize/rehype-harden pipeline runs before the `a` component.
 * A leading YAML front matter block is split off and rendered as a
 * key/value list above the content instead of falling through to
 * ChatMarkdown as body text (PAN-5427).
 */

import { Fragment } from 'react';

import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { LoadingBoundary } from '../../primitives/LoadingBoundary';
import { splitFrontMatter, type FrontMatterEntry } from '../../../lib/frontMatter';

interface MarkdownTabProps {
  body: string | undefined | null;
  isLoading?: boolean;
  emptyLabel?: string;
  docLocation?: { rootId: string; path: string };
}

export function MarkdownTab({ body, isLoading, emptyLabel = 'No content available.', docLocation }: MarkdownTabProps) {
  if (isLoading) {
    return (
      <div
        data-testid="markdown-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--muted-foreground)' }}
      >
        <LoadingBoundary label="The document"><span>Loading…</span></LoadingBoundary>
      </div>
    );
  }
  if (!body || body.trim() === '') {
    return (
      <div
        data-testid="markdown-tab-empty"
        style={{ padding: 16, fontSize: 12, color: 'var(--muted-foreground)' }}
      >
        {emptyLabel}
      </div>
    );
  }
  const { entries, content } = splitFrontMatter(body);
  return (
    <div
      data-testid="markdown-tab"
      style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}
    >
      {entries.length > 0 ? <FrontMatterList entries={entries} /> : null}
      {content.trim() !== '' ? (
        <ChatMarkdown text={content} cwd={undefined} docLocation={docLocation} {...(docLocation ? { useStreamdown: false } : {})} />
      ) : null}
    </div>
  );
}

function FrontMatterList({ entries }: { entries: FrontMatterEntry[] }) {
  return (
    <dl
      data-testid="markdown-front-matter"
      className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 border-b border-border pb-3 text-[12px]"
    >
      {entries.map((e, i) => (
        <Fragment key={`${e.key}-${i}`}>
          <dt className="font-mono-ui text-muted-foreground">{e.key}</dt>
          <dd className="m-0 whitespace-pre-wrap">{e.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
