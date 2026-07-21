/**
 * Scan trigger button with result display (PAN-457)
 */

import { RefreshCw } from 'lucide-react';

interface ScanResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

interface ScanProgress {
  active: boolean;
  dirsProcessed: number;
  dirsTotal: number;
  sessionsFound: number;
  elapsedMs: number;
}

interface Props {
  isScanning: boolean;
  onScan: () => void;
  lastResult?: ScanResult;
  progress?: ScanProgress | null;
}

export function ScanButton({ isScanning, onScan, lastResult, progress }: Props) {
  const liveScanning = isScanning || progress?.active === true;
  return (
    <div className="flex items-center gap-2">
      {progress?.active ? (
        <span className="text-[10px] text-primary font-mono">
          {progress.dirsProcessed}/{progress.dirsTotal} files · {progress.sessionsFound} sessions · {(progress.elapsedMs / 1000).toFixed(1)}s
        </span>
      ) : lastResult && !liveScanning && (
        <span className="text-[10px] text-muted-foreground">
          +{lastResult.inserted} ↑{lastResult.updated} ·{(lastResult.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      <button
        onClick={onScan}
        disabled={liveScanning}
        className="flex items-center gap-1.5 rounded px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-xs transition-colors"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${liveScanning ? 'animate-spin' : ''}`} />
        {liveScanning ? 'Scanning…' : 'Scan'}
      </button>
    </div>
  );
}
