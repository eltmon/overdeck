/**
 * DiscussionsTab — unified Linear + GitHub timeline for the issue.
 *
 * Pulls from `/api/issues/:issueId/discussions` (pan-1r7j). Renders a single
 * chronological feed of:
 *   - Linear issue comments
 *   - GitHub issue comments (the issue itself, not the PR)
 *   - GitHub PR conversation comments
 *   - GitHub PR review submissions (approve / changes-requested / commented)
 *   - GitHub PR inline review comments (with file:line)
 *
 * Each row carries a source-colored chip + author + relative timestamp. Bodies
 * are rendered via ChatMarkdown so links, code blocks, and lists work. Errors
 * accumulated server-side (rate limit / not authenticated for one source) are
 * surfaced as a non-blocking note above the feed — partial data is better than
 * a blank tab.
 *
 * Polls every 30s (same cadence as costs and PR/Diff). The query cache is
 * keyed by issueId so re-entering this tab does not re-fetch.
 */

import { useMemo } from 'react';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import {
  useDiscussionsQuery,
  type DiscussionItem,
  type DiscussionSource,
} from './queries';

interface DiscussionsTabProps {
  issueId: string;
}

interface SourceStyle {
  bg: string;
  fg: string;
  label: string;
}

function sourceStyle(source: DiscussionSource, item: DiscussionItem): SourceStyle {
  switch (source) {
    case 'linear':
      return {
        bg: 'color-mix(in srgb, #5e6ad2 18%, transparent)',
        fg: '#5e6ad2',
        label: 'linear',
      };
    case 'github-issue':
      return {
        bg: 'color-mix(in srgb, var(--muted-foreground) 18%, transparent)',
        fg: 'var(--mc-text, var(--foreground))',
        label: 'issue',
      };
    case 'github-pr-conversation':
      return {
        bg: 'color-mix(in srgb, var(--primary) 18%, transparent)',
        fg: 'var(--primary)',
        label: 'pr',
      };
    case 'github-pr-review': {
      const verdict = (item.reviewState ?? '').toUpperCase();
      if (verdict === 'APPROVED') {
        return {
          bg: 'color-mix(in srgb, var(--success, #10b981) 18%, transparent)',
          fg: 'var(--success, #10b981)',
          label: 'approved',
        };
      }
      if (verdict === 'CHANGES_REQUESTED') {
        return {
          bg: 'color-mix(in srgb, var(--destructive) 18%, transparent)',
          fg: 'var(--destructive)',
          label: 'changes',
        };
      }
      if (verdict === 'DISMISSED') {
        return {
          bg: 'color-mix(in srgb, var(--muted-foreground) 18%, transparent)',
          fg: 'var(--muted-foreground)',
          label: 'dismissed',
        };
      }
      return {
        bg: 'color-mix(in srgb, var(--primary) 18%, transparent)',
        fg: 'var(--primary)',
        label: 'review',
      };
    }
    case 'github-pr-review-comment':
      return {
        bg: 'color-mix(in srgb, #a855f7 18%, transparent)',
        fg: '#a855f7',
        label: 'inline',
      };
    default:
      return {
        bg: 'var(--muted)',
        fg: 'var(--muted-foreground)',
        label: source,
      };
  }
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diffSec = (Date.now() - t) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

function SourceChip({ item }: { item: DiscussionItem }) {
  const style = sourceStyle(item.source, item);
  return (
    <span
      data-testid={`discussion-chip-${item.source}`}
      style={{
        background: style.bg,
        color: style.fg,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '2px 6px',
        borderRadius: 4,
      }}
    >
      {style.label}
    </span>
  );
}

function DiscussionRow({ item }: { item: DiscussionItem }) {
  const isInline = item.source === 'github-pr-review-comment';
  return (
    <li
      data-testid={`discussion-row-${item.id}`}
      style={{
        listStyle: 'none',
        padding: '12px 14px',
        borderBottom: '1px solid var(--mc-border, var(--border))',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        contentVisibility: 'auto',
        containIntrinsicHeight: '60px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <SourceChip item={item} />
        <span style={{ fontWeight: 600, color: 'var(--mc-text, var(--foreground))' }}>
          {item.author || 'unknown'}
        </span>
        <span style={{ color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
          {formatRelative(item.createdAt)}
        </span>
        {isInline && item.filePath && (
          <span
            data-testid={`discussion-file-${item.id}`}
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono, ui-monospace)',
              fontSize: 11,
              color: 'var(--mc-text-muted, var(--muted-foreground))',
            }}
          >
            {item.filePath}
            {item.line ? `:${item.line}` : ''}
          </span>
        )}
        {item.url && !isInline && (
          <a
            data-testid={`discussion-link-${item.id}`}
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--mc-text-muted, var(--muted-foreground))',
              textDecoration: 'none',
            }}
          >
            ↗
          </a>
        )}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        {item.body && item.body.trim() !== '' ? (
          <ChatMarkdown text={item.body} />
        ) : (
          <span
            style={{
              fontStyle: 'italic',
              color: 'var(--mc-text-muted, var(--muted-foreground))',
              fontSize: 12,
            }}
          >
            (no body)
          </span>
        )}
      </div>
    </li>
  );
}

export function DiscussionsTab({ issueId }: DiscussionsTabProps) {
  const { data, isLoading, isError } = useDiscussionsQuery(issueId);

  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    // Reverse chronological for display so newest is at top
    return [...data.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data?.items]);

  if (isLoading) {
    return (
      <div
        data-testid="discussions-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
      >
        Loading discussions…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="discussions-tab-error"
        style={{
          padding: 16,
          fontSize: 12,
          color: 'var(--destructive)',
          background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
        }}
      >
        Failed to load discussions for {issueId}.
      </div>
    );
  }

  const errors = data?.errors ?? [];
  const isEmpty = sortedItems.length === 0;

  return (
    <div
      data-testid="discussions-tab"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--mc-border, var(--border))',
          fontSize: 12,
          color: 'var(--mc-text-muted, var(--muted-foreground))',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span data-testid="discussions-tab-summary">
          {sortedItems.length} {sortedItems.length === 1 ? 'message' : 'messages'}
          {data?.prNumber ? ` · PR #${data.prNumber}` : ''}
        </span>
      </div>

      {errors.length > 0 && (
        <div
          data-testid="discussions-tab-warnings"
          style={{
            padding: '8px 14px',
            fontSize: 11,
            color: 'var(--destructive)',
            background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--destructive) 24%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {errors.map((e, i) => (
            <span key={i} data-testid={`discussions-tab-warning-${i}`}>{e}</span>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div
          data-testid="discussions-tab-empty"
          style={{
            padding: 16,
            fontSize: 12,
            color: 'var(--mc-text-muted, var(--muted-foreground))',
          }}
        >
          No discussions yet for {issueId}.
        </div>
      ) : (
        <ul
          data-testid="discussions-tab-feed"
          style={{
            margin: 0,
            padding: 0,
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
          {sortedItems.map((item) => (
            <DiscussionRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
