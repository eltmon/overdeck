import { useEffect, useState, useRef } from 'react';
import { Download, Loader2, X } from 'lucide-react';

interface LogViewerProps {
  project: string;
  type: string;
  runId: string;
  onClose?: () => void;
}

interface SSEMessage {
  type: 'content' | 'append' | 'complete';
  data?: string;
}

export function SpecialistLogViewer({ project, type, runId, onClose }: LogViewerProps) {
  const [log, setLog] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/specialists/${project}/${type}/runs/${runId}/stream`
    );

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);

        if (message.type === 'content') {
          setLog(message.data || '');
        } else if (message.type === 'append') {
          setLog((prev) => prev + (message.data || ''));
        } else if (message.type === 'complete') {
          setIsStreaming(false);
          eventSource.close();
        }
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      setError('Connection to log stream failed');
      setIsStreaming(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [project, type, runId]);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log, autoScroll]);

  const handleDownload = () => {
    const blob = new Blob([log], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${runId}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const highlightedLog = searchTerm
    ? log.split('\n').map((line, i) => {
        if (line.toLowerCase().includes(searchTerm.toLowerCase())) {
          const regex = new RegExp(`(${searchTerm})`, 'gi');
          const parts = line.split(regex);
          return (
            <div key={i} className="badge-bg-warning">
              {parts.map((part, j) =>
                regex.test(part) ? (
                  <span key={j} className="bg-warning text-warning-foreground">
                    {part}
                  </span>
                ) : (
                  <span key={j}>{part}</span>
                )
              )}
            </div>
          );
        }
        return <div key={i}>{line}</div>;
      })
    : log.split('\n').map((line, i) => <div key={i}>{line}</div>);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-foreground font-medium">
              {project}/{type}
            </div>
            <div className="text-sm text-muted-foreground font-mono">{runId}</div>
          </div>
          {isStreaming && (
            <div className="flex items-center gap-2 text-sm text-success">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Streaming...</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-1 bg-card text-foreground text-sm rounded border border-border focus:border-primary focus:outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
          <button
            onClick={handleDownload}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-popover rounded"
            title="Download log"
          >
            <Download className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-popover rounded"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-auto p-4">
        {error ? (
          <div className="text-destructive">{error}</div>
        ) : (
          <pre className="text-sm text-foreground font-mono whitespace-pre-wrap">
            {highlightedLog}
            <div ref={logEndRef} />
          </pre>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
        <div>{log.split('\n').length} lines</div>
        <div>{(new Blob([log]).size / 1024).toFixed(2)} KB</div>
      </div>
    </div>
  );
}
