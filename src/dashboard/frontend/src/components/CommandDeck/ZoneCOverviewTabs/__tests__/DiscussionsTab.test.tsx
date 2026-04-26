/**
 * DiscussionsTab unit tests (PAN-830, pan-1r7j).
 *
 * Mocks `useDiscussionsQuery` so the tab can be exercised without hitting
 * the network. Stubs ChatMarkdown to a passthrough so we can assert body
 * text directly.
 *
 * Cases:
 *   - Loading state
 *   - Error state (isError true)
 *   - Empty state (items === [])
 *   - Populated state — rows, source chips, author, file:line for inline,
 *     external-link arrow for non-inline, summary header with PR # and count
 *   - Server-side `errors[]` surfaces a non-blocking warnings row
 *   - Review state badges (approved / changes / dismissed) map to chip labels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscussionsTab } from '../DiscussionsTab';
import type { DiscussionItem, DiscussionsResponse } from '../queries';

const discussionsResult = vi.hoisted(() => ({
  data: undefined as undefined | DiscussionsResponse,
  isLoading: false,
  isError: false,
}));

vi.mock('../queries', () => ({
  useDiscussionsQuery: () => discussionsResult,
}));

// Passthrough so we can assert body text directly.
vi.mock('../../../chat/ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="chat-md">{text}</div>,
}));

const ISSUE = 'PAN-830';

function makeItem(overrides: Partial<DiscussionItem> = {}): DiscussionItem {
  return {
    id: 'i-1',
    source: 'github-issue',
    author: 'alice',
    body: 'hello',
    createdAt: '2026-04-20T00:00:00Z',
    ...overrides,
  };
}

describe('DiscussionsTab', () => {
  beforeEach(() => {
    discussionsResult.data = undefined;
    discussionsResult.isLoading = false;
    discussionsResult.isError = false;
  });

  it('renders the loading state', () => {
    discussionsResult.isLoading = true;
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussions-tab-loading')).toBeInTheDocument();
  });

  it('renders the error state when isError is true', () => {
    discussionsResult.isError = true;
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussions-tab-error')).toBeInTheDocument();
    expect(screen.getByTestId('discussions-tab-error').textContent).toContain(ISSUE);
  });

  it('renders the empty state when items are empty', () => {
    discussionsResult.data = { issueId: ISSUE, items: [], prNumber: null };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussions-tab-empty')).toBeInTheDocument();
    expect(screen.getByTestId('discussions-tab-empty').textContent).toContain(ISSUE);
  });

  it('renders the summary header with item count and PR number', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [makeItem()],
      prNumber: 642,
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussions-tab-summary').textContent).toContain('1 message');
    expect(screen.getByTestId('discussions-tab-summary').textContent).toContain('PR #642');
  });

  it('renders rows for each source with the right chip label', () => {
    const items: DiscussionItem[] = [
      makeItem({ id: 'i-linear', source: 'linear', author: 'eltmon', body: 'lin', createdAt: '2026-04-20T00:00:00Z' }),
      makeItem({ id: 'i-issue', source: 'github-issue', author: 'alice', body: 'iss', createdAt: '2026-04-21T00:00:00Z' }),
      makeItem({ id: 'i-conv', source: 'github-pr-conversation', author: 'bob', body: 'conv', createdAt: '2026-04-22T00:00:00Z', url: 'https://gh/u' }),
      makeItem({ id: 'i-rev', source: 'github-pr-review', reviewState: 'APPROVED', author: 'carol', body: 'lgtm', createdAt: '2026-04-23T00:00:00Z' }),
      makeItem({ id: 'i-inline', source: 'github-pr-review-comment', author: 'carol', body: 'tweak', createdAt: '2026-04-21T12:00:00Z', filePath: 'src/foo.ts', line: 42 }),
    ];
    discussionsResult.data = { issueId: ISSUE, items, prNumber: 642 };
    render(<DiscussionsTab issueId={ISSUE} />);

    // Rows
    expect(screen.getByTestId('discussion-row-i-linear')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-row-i-issue')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-row-i-conv')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-row-i-rev')).toBeInTheDocument();
    expect(screen.getByTestId('discussion-row-i-inline')).toBeInTheDocument();

    // Chips with right labels
    expect(screen.getByTestId('discussion-chip-linear').textContent).toBe('linear');
    expect(screen.getByTestId('discussion-chip-github-issue').textContent).toBe('issue');
    expect(screen.getByTestId('discussion-chip-github-pr-conversation').textContent).toBe('pr');
    expect(screen.getByTestId('discussion-chip-github-pr-review').textContent).toBe('approved');
    expect(screen.getByTestId('discussion-chip-github-pr-review-comment').textContent).toBe('inline');

    // Inline shows file:line, not external link
    expect(screen.getByTestId('discussion-file-i-inline').textContent).toBe('src/foo.ts:42');
    expect(screen.queryByTestId('discussion-link-i-inline')).not.toBeInTheDocument();

    // Conversation row has external link arrow
    expect(screen.getByTestId('discussion-link-i-conv')).toBeInTheDocument();
  });

  it('renders the changes-requested chip for review state CHANGES_REQUESTED', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [
        makeItem({ id: 'r1', source: 'github-pr-review', reviewState: 'CHANGES_REQUESTED', body: 'fix it' }),
      ],
      prNumber: 1,
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussion-chip-github-pr-review').textContent).toBe('changes');
  });

  it('renders the dismissed chip for review state DISMISSED', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [
        makeItem({ id: 'r1', source: 'github-pr-review', reviewState: 'DISMISSED', body: 'never mind' }),
      ],
      prNumber: 1,
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussion-chip-github-pr-review').textContent).toBe('dismissed');
  });

  it('renders the generic review chip when no review state is set', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [
        makeItem({ id: 'r1', source: 'github-pr-review', body: 'just a comment' }),
      ],
      prNumber: 1,
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussion-chip-github-pr-review').textContent).toBe('review');
  });

  it('surfaces server-side errors[] as a non-blocking warnings row', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [makeItem()],
      prNumber: null,
      errors: ['gh issue comments failed: not authenticated', 'gh pr conversation failed: rate limit'],
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussions-tab-warnings')).toBeInTheDocument();
    expect(screen.getByTestId('discussions-tab-warning-0').textContent).toContain('gh issue comments failed');
    expect(screen.getByTestId('discussions-tab-warning-1').textContent).toContain('gh pr conversation failed');
    // Item is still rendered (partial success).
    expect(screen.getByTestId('discussion-row-i-1')).toBeInTheDocument();
  });

  it('falls back to "(no body)" when an item has empty body', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [makeItem({ body: '' })],
      prNumber: null,
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    expect(screen.getByTestId('discussion-row-i-1').textContent).toContain('(no body)');
  });

  it('sorts items reverse-chronologically (newest first)', () => {
    discussionsResult.data = {
      issueId: ISSUE,
      items: [
        makeItem({ id: 'a', body: 'older', createdAt: '2026-04-20T00:00:00Z' }),
        makeItem({ id: 'b', body: 'newest', createdAt: '2026-04-23T00:00:00Z' }),
        makeItem({ id: 'c', body: 'middle', createdAt: '2026-04-21T00:00:00Z' }),
      ],
      prNumber: null,
    };
    render(<DiscussionsTab issueId={ISSUE} />);
    const feed = screen.getByTestId('discussions-tab-feed');
    const rows = feed.querySelectorAll('[data-testid^="discussion-row-"]');
    expect(rows[0]?.getAttribute('data-testid')).toBe('discussion-row-b'); // newest first
    expect(rows[1]?.getAttribute('data-testid')).toBe('discussion-row-c');
    expect(rows[2]?.getAttribute('data-testid')).toBe('discussion-row-a');
  });
});
