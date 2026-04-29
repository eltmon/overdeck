/**
 * MarkdownTab — renders a markdown body via ChatMarkdown with empty/loading states.
 *
 * Used for PRD / STATE.md / INFERENCE.md tabs. The actual fetch happens once at
 * the ZoneCOverview level (`usePlanningQuery`) — this component only formats.
 */

import { ChatMarkdown } from '../../chat/ChatMarkdown';

interface MarkdownTabProps {
  body: string | undefined | null;
  isLoading?: boolean;
  emptyLabel?: string;
}

export function MarkdownTab({ body, isLoading, emptyLabel = 'No content available.' }: MarkdownTabProps) {
  if (isLoading) {
    return (
      <div
        data-testid="markdown-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--muted-foreground)' }}
      >
        Loading…
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
      <ChatMarkdown text={body} />
    </div>
  );
}
