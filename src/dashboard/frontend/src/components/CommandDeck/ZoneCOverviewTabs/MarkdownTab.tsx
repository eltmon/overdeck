/**
 * MarkdownTab — renders a markdown body via ChatMarkdown with empty/loading states.
 *
 * Used for PRD / STATE / INFERENCE tabs. The actual fetch happens once at
 * the ZoneCOverview level (`usePlanningQuery`) — this component only formats.
 */

import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { LoadingBoundary } from '../../primitives/LoadingBoundary';

interface MarkdownTabProps {
  body: string | undefined | null;
  isLoading?: boolean;
  emptyLabel?: string;
  /** Render a relative-href anchor as plain text (PAN-5338 D-11); default false. */
  plainRelativeLinks?: boolean;
}

export function MarkdownTab({
  body,
  isLoading,
  emptyLabel = 'No content available.',
  plainRelativeLinks,
}: MarkdownTabProps) {
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
  return (
    <div
      data-testid="markdown-tab"
      style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}
    >
      <ChatMarkdown text={body} cwd={undefined} plainRelativeLinks={plainRelativeLinks} />
    </div>
  );
}
