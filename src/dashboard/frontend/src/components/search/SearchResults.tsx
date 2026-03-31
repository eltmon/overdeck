import { Command } from 'cmdk';
import { ExternalLink, Github, Circle } from 'lucide-react';
import { SearchResult } from '../../hooks/useSearch';
import { STATUS_LABELS } from '../../types';

interface SearchResultsProps {
  groupedResults: Record<string, SearchResult[]>;
  onSelect: (issueIdentifier: string) => void;
  onExternalLink: (url: string, e: React.MouseEvent) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  linear: 'Linear',
  github: 'GitHub',
  rally: 'Rally',
  gitlab: 'GitLab',
  jira: 'Jira',
  unknown: 'Unknown',
};

const PRIORITY_COLORS: Record<number, string> = {
  0: 'text-content-muted',
  1: 'text-red-500',
  2: 'text-orange-500',
  3: 'text-yellow-500',
  4: 'text-blue-500',
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-surface-emphasis',
  todo: 'bg-blue-600',
  in_progress: 'bg-yellow-600',
  in_review: 'bg-pink-600',
  done: 'bg-green-600',
  canceled: 'bg-gray-500',
};

export function SearchResults({ groupedResults, onSelect, onExternalLink }: SearchResultsProps) {
  const sources = Object.keys(groupedResults).sort();

  return (
    <>
      {sources.map((source) => (
        <Command.Group key={source} heading={SOURCE_LABELS[source] || source}>
          {groupedResults[source].map((result) => {
            const { issue, matchType } = result;
            const canonicalStatus = STATUS_LABELS[issue.status] || 'backlog';

            return (
              <Command.Item
                key={issue.id}
                value={issue.identifier}
                onSelect={() => onSelect(issue.identifier)}
                className="px-4 py-3 cursor-pointer hover:bg-surface-overlay transition-colors border-b border-divider last:border-b-0 aria-selected:bg-surface-overlay"
              >
                <div className="flex items-start gap-3">
                  {/* Project color indicator */}
                  {issue.project && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                      style={{ backgroundColor: issue.project.color || '#6b7280' }}
                      title={issue.project.name}
                    />
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Identifier */}
                      <span className="text-sm font-medium text-content flex items-center gap-1">
                        {issue.source === 'github' && (
                          <Github className="w-3 h-3 text-content-subtle" />
                        )}
                        <span className="text-content-subtle">{issue.identifier}</span>
                      </span>

                      {/* Status badge */}
                      <span
                        className={`px-2 py-0.5 rounded text-xs text-content ${
                          STATUS_COLORS[canonicalStatus] || 'bg-surface-emphasis'
                        }`}
                      >
                        {issue.status}
                      </span>

                      {/* Priority indicator */}
                      <span title={`Priority ${issue.priority}`}>
                        <Circle
                          className={`w-2 h-2 fill-current ${
                            PRIORITY_COLORS[issue.priority] || 'text-content-muted'
                          }`}
                        />
                      </span>

                      {/* Match type badge */}
                      {matchType && (
                        <span className="text-xs text-content-muted">
                          ({matchType} match)
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <p className="text-sm text-content-body mt-1 line-clamp-2">{issue.title}</p>

                    {/* Labels */}
                    {issue.labels.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        {issue.labels.slice(0, 3).map((label) => (
                          <span
                            key={label}
                            className="text-xs bg-surface-overlay text-content-subtle px-2 py-0.5 rounded"
                          >
                            {label}
                          </span>
                        ))}
                        {issue.labels.length > 3 && (
                          <span className="text-xs text-content-muted">
                            +{issue.labels.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* External link */}
                  <button
                    onClick={(e) => onExternalLink(issue.url, e)}
                    className="p-1 text-content-subtle hover:text-blue-400 hover:bg-surface-emphasis rounded transition-colors shrink-0"
                    title="Open in tracker"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </Command.Item>
            );
          })}
        </Command.Group>
      ))}
    </>
  );
}
