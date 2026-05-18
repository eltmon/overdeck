import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import type { SearchResult } from '../../hooks/useSearch';
import { SearchModal } from './SearchModal';

const mockUseSearch = vi.fn();
const mockPrefetchQuery = vi.fn().mockResolvedValue(undefined);

HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(),
}));

vi.mock('../../hooks/useSearch', () => ({
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
}));

const searchResult: SearchResult = {
  issue: {
    id: '1',
    identifier: 'PAN-123',
    title: 'Fix dashboard search bug',
    description: 'The search feature has a critical issue',
    status: 'In Progress',
    priority: 1,
    labels: ['bug'],
    url: 'https://example.com/PAN-123',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-02',
    source: 'linear',
  },
  score: 100,
  matchType: 'identifier',
};

describe('SearchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQueryClient).mockReturnValue({
      prefetchQuery: mockPrefetchQuery,
    } as any);

    mockUseSearch.mockImplementation((query: string) => {
      if (query.length < 2) {
        return {
          groupedResults: {},
          isSearching: false,
          hasResults: false,
          resultCount: 0,
        };
      }

      return {
        groupedResults: {
          linear: [searchResult],
        },
        isSearching: false,
        hasResults: true,
        resultCount: 1,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects issue and closes modal when search result is clicked', async () => {
    const onClose = vi.fn();
    const onSelectIssue = vi.fn();

    render(
      <SearchModal
        isOpen={true}
        onClose={onClose}
        onSelectIssue={onSelectIssue}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search issues...'), {
      target: { value: 'PAN' },
    });

    fireEvent.click(await screen.findByText('Fix dashboard search bug'));

    await waitFor(() => {
      expect(onSelectIssue).toHaveBeenCalledWith('PAN-123');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('opens tracker link without selecting issue or closing modal', async () => {
    const onClose = vi.fn();
    const onSelectIssue = vi.fn();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <SearchModal
        isOpen={true}
        onClose={onClose}
        onSelectIssue={onSelectIssue}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search issues...'), {
      target: { value: 'PAN' },
    });

    fireEvent.click(await screen.findByTitle('Open in tracker'));

    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/PAN-123',
      '_blank',
      'noopener,noreferrer'
    );
    expect(onSelectIssue).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
