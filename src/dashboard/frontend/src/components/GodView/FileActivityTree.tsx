import { useQuery } from '@tanstack/react-query';
import { FileCode, FilePlus, FileEdit, FileX } from 'lucide-react';

interface FileEntry {
  status: string;
  path: string;
}

interface FileActivityTreeProps {
  agentId: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  M: <FileEdit className="w-3 h-3 shrink-0" style={{ color: 'var(--gv-amber)' }} />,
  A: <FilePlus className="w-3 h-3 shrink-0" style={{ color: 'var(--gv-green)' }} />,
  D: <FileX className="w-3 h-3 shrink-0" style={{ color: 'var(--gv-pink)' }} />,
  '?': <FileCode className="w-3 h-3 shrink-0" style={{ color: 'var(--gv-text-secondary)' }} />,
};

export function FileActivityTree({ agentId }: FileActivityTreeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['agent-files', agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/files`);
      if (!res.ok) return { files: [] };
      return res.json() as Promise<{ files: FileEntry[] }>;
    },
    refetchInterval: 15000,
    enabled: !!agentId,
  });

  if (isLoading) {
    return (
      <div className="text-[10px]" style={{ color: 'var(--gv-text-dim)' }}>
        Loading files...
      </div>
    );
  }

  const files = data?.files || [];

  if (files.length === 0) {
    return (
      <div className="text-[10px]" style={{ color: 'var(--gv-text-dim)' }}>
        No changed files
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {STATUS_ICONS[f.status] || STATUS_ICONS['?']}
          <span
            className="text-[10px] gv-mono truncate"
            style={{ color: 'var(--gv-text-secondary)' }}
            title={f.path}
          >
            {f.path}
          </span>
        </div>
      ))}
    </div>
  );
}
