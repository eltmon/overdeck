import type { CapacityForecastSnapshot } from '../../types';

interface ForecastBarProps {
  forecast?: CapacityForecastSnapshot;
}

export function ForecastBar({ forecast }: ForecastBarProps) {
  const predictedRam = forecast?.stacks.reduce((sum, stack) => sum + stack.predictedRamBytes, 0) ?? 0;
  const predictedLoad = forecast?.stacks.reduce((sum, stack) => sum + stack.predictedLoad, 0) ?? 0;
  const stoppedCount = forecast?.stacks.length ?? 0;
  const freeRam = forecast?.headroom.freeRamBytes ?? 0;
  const fits = predictedRam <= freeRam && predictedLoad <= (forecast?.headroom.loadHeadroom ?? 0);

  return (
    <div className={`border px-4 py-3 text-sm ${fits ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700' : 'border-amber-500/60 bg-amber-500/10 text-amber-700'}`}>
      Starting {stoppedCount} stopped stack{stoppedCount === 1 ? '' : 's'} ≈ +{formatBytes(predictedRam)} RAM, +{Math.round(predictedLoad)} load → {fits ? 'fits' : 'does not fit'} ({formatBytes(freeRam)} free)
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}
