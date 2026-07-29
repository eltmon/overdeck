import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, X } from 'lucide-react';
import { ChatMarkdown } from './chat/ChatMarkdown';

interface PrdResponse {
  hasPrd: true;
  content: string;
  path: string;
  status: string;
  format: string;
}

interface PrdViewerProps {
  issueId: string;
  onClose: () => void;
}

export function PrdViewer({ issueId, onClose }: PrdViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [issueId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const { data, isLoading, isError } = useQuery<PrdResponse | null>({
    queryKey: ['issue-prd', issueId],
    queryFn: async () => {
      const response = await fetch(`/api/issues/${issueId}/prd`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Failed to fetch PRD: HTTP ${response.status}`);
      return response.json() as Promise<PrdResponse>;
    },
    retry: false,
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        className="relative bg-card rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] overflow-hidden flex flex-col focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prd-viewer-title"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-signal-review shrink-0" />
            <div className="min-w-0">
              <h2 id="prd-viewer-title" className="font-medium text-foreground">
                PRD: <span className="font-mono">{issueId}</span>
              </h2>
              {data?.path && (
                <div className="text-xs text-muted-foreground font-mono truncate" title={data.path}>
                  {data.path}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors"
            aria-label="Close PRD viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {isLoading && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading PRD...
            </div>
          )}
          {isError && (
            <div className="flex items-center justify-center h-full text-sm text-destructive">
              Failed to load PRD.
            </div>
          )}
          {!isLoading && !isError && !data && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No PRD draft for this issue.
            </div>
          )}
          {data && <ChatMarkdown text={data.content} issueId={issueId} />}
        </div>
      </div>
    </div>
  );
}
