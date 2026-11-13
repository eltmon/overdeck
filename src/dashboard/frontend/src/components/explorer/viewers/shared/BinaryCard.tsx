/** The generic card for a file no viewer shows: name, size and a Download link (PAN-5188 FR-18). */
import { Download, FileQuestion } from 'lucide-react';

import { formatSize } from './formatSize';

export interface BinaryCardProps {
  name: string;
  size: number;
  downloadUrl: string;
  notice?: string;
}

export function BinaryCard({ name, size, downloadUrl, notice }: BinaryCardProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-md border border-border bg-card px-6 py-5 text-center">
        <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="break-all font-mono text-xs text-foreground">{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatSize(size)}</p>
        </div>
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        <a
          href={downloadUrl}
          download={name}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download
        </a>
      </div>
    </div>
  );
}
