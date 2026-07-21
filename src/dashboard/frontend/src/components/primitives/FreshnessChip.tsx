/**
 * PAN-2908 · C-FRESH — the freshness chip: "updated Ns ago" with a live tick,
 * green under 30s, muted under 2m, warning past that. Used by feeds to show
 * their data boundary instead of spinning forever.
 */
import { useEffect, useState } from 'react';

function ageText(iso: string, now: number): { text: string; tone: 'fresh' | 'ok' | 'stale' } {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { text: 'no data yet', tone: 'stale' };
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 30) return { text: `updated ${s}s ago`, tone: 'fresh' };
  if (s < 120) return { text: `updated ${Math.round(s / 5) * 5}s ago`, tone: 'ok' };
  return { text: `updated ${Math.round(s / 60)}m ago — stale`, tone: 'stale' };
}

const TONE_CLASS = {
  fresh: 'text-success-foreground',
  ok: 'text-muted-foreground',
  stale: 'text-warning-foreground',
};

export function FreshnessChip({ timestamp, className = '' }: { timestamp: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  if (!timestamp) return null;
  const { text, tone } = ageText(timestamp, now);
  return (
    <span data-component="freshness-chip" data-tone={tone} className={`inline-flex items-center gap-1 text-[10px] ${TONE_CLASS[tone]} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone === 'fresh' ? 'bg-success' : tone === 'ok' ? 'bg-muted-foreground' : 'bg-warning'}`} />
      {text}
    </span>
  );
}
