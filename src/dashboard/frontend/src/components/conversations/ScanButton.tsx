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
        <span className="text-[10px] text-blue-300 font-mono">
          {progress.dirsProcessed}/{progress.dirsTotal} files · {progress.sessionsFound} sessions · {(progress.elapsedMs / 1000).toFixed(1)}s
        </span>
      ) : lastResult && !liveScanning && (
        <span className="text-[10px] text-gray-500">
          +{lastResult.inserted} ↑{lastResult.updated} ·{(lastResult.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      <button
        onClick={onScan}
        disabled={liveScanning}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded text-xs transition-colors"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${liveScanning ? 'animate-spin' : ''}`} />
        {liveScanning ? 'Scanning…' : 'Scan'}
      </button>
    </div>
  );
}
