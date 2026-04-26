import { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import { X, Search, Github } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Issue, IssueSource } from '../../types';
import { useSearch, SearchFilters } from '../../hooks/useSearch';
import { SearchResults } from './SearchResults';

async function fetchIssues(cycle: string, includeCompleted: boolean): Promise<Issue[]> {
  const params = new URLSearchParams();
  params.set('cycle', cycle);
  if (includeCompleted) params.set('includeCompleted', 'true');
  const res = await fetch(`/api/issues?${params}`);
  if (!res.ok) throw new Error('Failed to fetch issues');
  return res.json();
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectIssue: (issueId: string) => void;
  cycleFilter?: 'current' | 'all' | 'backlog';
  includeCompletedFilter?: boolean;
}

export function SearchModal({
  isOpen,
  onClose,
  onSelectIssue,
  cycleFilter = 'current',
  includeCompletedFilter = false,
}: SearchModalProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({
    sources: new Set<IssueSource>(),
    includeCompleted: false,
    deepSearch: false,
  });

  const { groupedResults, isSearching, hasResults, resultCount } = useSearch(
    query,
    filters,
    { cycleFilter, includeCompletedFilter }
  );

  // When search opens, ensure completed issues are in the cache so they're searchable
  useEffect(() => {
    if (isOpen) {
      queryClient.prefetchQuery({
        queryKey: ['issues', cycleFilter, true],
        queryFn: () => fetchIssues(cycleFilter, true),
        staleTime: 30_000,
      });
    }
  }, [isOpen, cycleFilter, queryClient]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setFilters({
        sources: new Set(),
        includeCompleted: false,
        deepSearch: false,
      });
    }
  }, [isOpen]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  const toggleSource = (source: IssueSource) => {
    setFilters((prev) => {
      const newSources = new Set(prev.sources);
      if (newSources.has(source)) {
        newSources.delete(source);
      } else {
        newSources.add(source);
      }
      return { ...prev, sources: newSources };
    });
  };

  const handleSelect = (issueIdentifier: string) => {
    onSelectIssue(issueIdentifier);
    onClose();
  };

  const handleExternalLink = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[70vh] overflow-hidden flex flex-col border border-border">
        <Command className="flex flex-col h-full" shouldFilter={false}>
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search issues..."
              className="flex-1 bg-transparent text-foreground placeholder-gray-400 focus:outline-none text-base"
              autoFocus
            />
            <button
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card flex-wrap">
            <span className="text-xs text-muted-foreground">Filters:</span>

            {/* Source toggles */}
            {(['linear', 'github', 'rally'] as IssueSource[]).map((source) => (
              <button
                key={source}
                onClick={() => toggleSource(source)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  filters.sources.size === 0 || filters.sources.has(source)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-popover text-muted-foreground hover:text-foreground'
                }`}
              >
                {source === 'github' && <Github className="w-3 h-3 inline mr-1" />}
                {source.charAt(0).toUpperCase() + source.slice(1)}
              </button>
            ))}

            <div className="w-px h-4 bg-card" />

            {/* Include completed toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeCompleted}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, includeCompleted: e.target.checked }))
                }
                className="w-3 h-3 rounded border-border bg-popover text-primary focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">Show completed</span>
            </label>

            {/* Deep search toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.deepSearch}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, deepSearch: e.target.checked }))
                }
                className="w-3 h-3 rounded border-border bg-popover text-primary focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">Deep search</span>
            </label>
          </div>

          {/* Results */}
          <Command.List className="flex-1 overflow-y-auto">
            {query.length > 0 && query.length < 2 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search
              </div>
            )}

            {query.length >= 2 && isSearching && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Searching...
              </div>
            )}

            {query.length >= 2 && !isSearching && !hasResults && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No issues found
              </div>
            )}

            {query.length >= 2 && !isSearching && hasResults && (
              <SearchResults
                groupedResults={groupedResults}
                onSelect={handleSelect}
                onExternalLink={handleExternalLink}
              />
            )}
          </Command.List>

          {/* Footer */}
          {resultCount > 0 && (
            <div className="px-4 py-2 border-t border-border bg-card text-xs text-muted-foreground flex items-center justify-between">
              <span>{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-popover rounded text-xs">↑</kbd>
                  <kbd className="px-1.5 py-0.5 bg-popover rounded text-xs">↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-popover rounded text-xs">Enter</kbd>
                  select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-popover rounded text-xs">Esc</kbd>
                  close
                </span>
              </div>
            </div>
          )}
        </Command>
      </div>
    </div>
  );
}
