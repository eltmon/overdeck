import { cn } from '../../../lib/utils';

export interface CostIndicatorProps {
  level: number; // 1-5 (1 = cheapest, 5 = most expensive)
  color: string; // accent color (e.g., '#fbbf24' for gold)
}

export function CostIndicator({ level, color }: CostIndicatorProps) {
  const dots = Array.from({ length: 5 }, (_, i) => i + 1);

  return (
    <div className="mt-auto pt-4 border-t border-slate-700/50 flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#a390cb]">Cost Meter</span>
      <div className="flex gap-1">
        {dots.map((dot) => (
          <span
            key={dot}
            className={cn('size-2 rounded-full', dot <= level ? `opacity-100` : 'opacity-30')}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}
