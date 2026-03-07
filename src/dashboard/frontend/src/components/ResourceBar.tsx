/**
 * ResourceBar — horizontal utilization bar with color thresholds.
 * Green 0–60%, Yellow 60–85%, Red 85%+.
 */

interface ResourceBarProps {
  value: number;   // 0–100
  label?: string;
  showValue?: boolean;
  className?: string;
}

function getBarColor(value: number): string {
  if (value >= 85) return 'bg-red-500';
  if (value >= 60) return 'bg-yellow-400';
  return 'bg-green-500';
}

export function ResourceBar({ value, label, showValue = true, className = '' }: ResourceBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const color = getBarColor(clamped);

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {(label || showValue) && (
        <div className="flex justify-between items-center">
          {label && <span className="text-xs text-content-subtle">{label}</span>}
          {showValue && <span className="text-xs text-content-subtle ml-auto">{clamped.toFixed(1)}%</span>}
        </div>
      )}
      <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
