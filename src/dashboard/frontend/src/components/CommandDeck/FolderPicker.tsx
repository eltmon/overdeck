import { useState, useEffect, useCallback } from 'react';
import { fetchWithTimeout } from '../../lib/apiFetch.js';

interface DirEntry {
  name: string;
  path: string;
}

interface ListDirsResponse {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}

export interface FolderPickerProps {
  onSelect: (path: string) => void;
  initialPath?: string;
}

async function listDirs(path?: string): Promise<ListDirsResponse> {
  const url = path
    ? `/api/fs/list-dirs?path=${encodeURIComponent(path)}`
    : '/api/fs/list-dirs';
  const res = await fetchWithTimeout(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`list-dirs failed: ${res.status}`);
  return res.json() as Promise<ListDirsResponse>;
}

export function FolderPicker({ onSelect, initialPath }: FolderPickerProps) {
  const [data, setData] = useState<ListDirsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback((path?: string) => {
    setLoading(true);
    setError(null);
    listDirs(path)
      .then((result) => { setData(result); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    navigate(initialPath);
  }, [navigate, initialPath]);

  return (
    <div
      data-testid="folder-picker"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 13,
        color: 'var(--foreground)',
      }}
    >
      {/* Current path + up affordance */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 24 }}>
        {data?.parent != null && (
          <button
            data-testid="folder-picker-up"
            onClick={() => navigate(data.parent ?? undefined)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
              color: 'var(--muted-foreground)',
              fontSize: 13,
            }}
          >
            ↑
          </button>
        )}
        <span
          data-testid="folder-picker-path"
          style={{
            color: 'var(--muted-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {data?.path ?? ''}
        </span>
        <button
          data-testid="folder-picker-select"
          disabled={!data}
          onClick={() => { if (data) onSelect(data.path); }}
          style={{
            padding: '2px 10px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            cursor: data ? 'pointer' : 'default',
            color: 'var(--foreground)',
            fontSize: 12,
          }}
        >
          Select
        </button>
      </div>

      {/* Status */}
      {loading && (
        <span data-testid="folder-picker-loading" style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>
          Loading…
        </span>
      )}
      {error && (
        <span data-testid="folder-picker-error" style={{ color: 'var(--destructive)', fontSize: 12 }}>
          {error}
        </span>
      )}

      {/* Directory list */}
      {!loading && !error && data && (
        <div
          data-testid="folder-picker-entries"
          style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 240, overflowY: 'auto' }}
        >
          {data.entries.length === 0 && (
            <span style={{ color: 'var(--muted-foreground)', fontSize: 12, padding: '4px 0' }}>
              No subdirectories
            </span>
          )}
          {data.entries.map((entry) => (
            <button
              key={entry.path}
              data-testid="folder-picker-entry"
              data-path={entry.path}
              onClick={() => navigate(entry.path)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                padding: '3px 6px',
                borderRadius: 4,
                color: 'var(--foreground)',
                fontSize: 13,
              }}
            >
              {entry.name}/
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
