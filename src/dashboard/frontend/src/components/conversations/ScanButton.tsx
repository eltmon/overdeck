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

interface Props {
  isScanning: boolean;
  onScan: () => void;
  lastResult?: ScanResult;
}

export function ScanButton({ isScanning, onScan, lastResult }: Props) {
  return (
    <div className="flex items-center gap-2">
      {lastResult && !isScanning && (
        <span className="text-[10px] text-gray-500">
          +{lastResult.inserted} ↑{lastResult.updated} ·{(lastResult.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      <button
        onClick={onScan}
        disabled={isScanning}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded text-xs transition-colors"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
        {isScanning ? 'Scanning…' : 'Scan'}
      </button>
    </div>
  );
}
