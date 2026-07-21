import { useEffect, useState } from 'react';
import type { ResourceHistoryAnnotation, ResourceHistorySnapshot } from '../../types';
import { ForecastBar } from './ForecastBar';
import type { CapacityForecastSnapshot } from '../../types';

interface HistorySectionProps {
  forecast?: CapacityForecastSnapshot;
  history?: ResourceHistorySnapshot;
  onHighlightTarget?: (target: string) => void;
}

async function fetchHistory(): Promise<ResourceHistorySnapshot> {
  const response = await fetch('/api/resources/history/24h');
  if (!response.ok) throw new Error('Failed to fetch resources history');
  return response.json();
}

export function HistorySection({ forecast, history, onHighlightTarget }: HistorySectionProps) {
  const [loadedHistory, setLoadedHistory] = useState<ResourceHistorySnapshot | null>(null);

  useEffect(() => {
    if (history !== undefined) return;
    let cancelled = false;
    fetchHistory()
      .then((result) => {
        if (!cancelled) setLoadedHistory(result);
      })
      .catch(() => {
        if (!cancelled) setLoadedHistory(emptyHistory());
      });
    return () => {
      cancelled = true;
    };
  }, [history]);

  const data = normalizeHistory(history ?? loadedHistory ?? emptyHistory());

  return (
    <section className="mb-6 grid gap-4 xl:grid-cols-[1fr_320px]" aria-label="Last 24h">
      <div className="border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-['DM_Mono'] text-xs uppercase text-muted-foreground">Last 24h</h2>
        </div>
        <ResourceHistoryChart history={data} />
        <div className="border-t border-border p-4">
          <ForecastBar forecast={forecast} />
        </div>
      </div>
      <div className="border border-border bg-background">
        <div className="border-b border-border px-4 py-3 font-['DM_Mono'] text-xs uppercase text-muted-foreground">Annotations</div>
        <div className="divide-y divide-border">
          {data.annotations.map((annotation) => (
            <button
              key={`${annotation.ts}:${annotation.targetKind}:${annotation.targetId}`}
              type="button"
              className="block w-full px-4 py-3 text-left text-sm hover:bg-muted/40"
              onClick={() => activateAnnotation(annotation, onHighlightTarget)}
            >
              <span className="block font-medium text-foreground">{annotation.label}</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{annotation.targetKind}:{annotation.targetId}</span>
            </button>
          ))}
          {data.annotations.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No annotations</div>}
        </div>
      </div>
    </section>
  );
}

export function ResourceHistoryChart({ history }: { history: ResourceHistorySnapshot }) {
  const width = 720;
  const height = 180;
  const startMs = Date.parse(history.startedAt);
  const endMs = Math.max(Date.now(), ...history.cpu.map((point) => Date.parse(point.ts)), ...history.mem.map((point) => Date.parse(point.ts)));
  const span = Math.max(1, endMs - startMs);
  const cpuPoints = pointsFor(history.cpu, startMs, span, width, height, 0.45);
  const memPoints = pointsFor(history.mem, startMs, span, width, height, 0.9);

  return (
    <svg role="img" aria-label="Resource history chart" viewBox={`0 0 ${width} ${height}`} className="h-56 w-full px-4 py-3">
      <defs>
        <linearGradient id="resource-history-cpu" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={memPoints} opacity="0.38" />
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={cpuPoints} />
      {history.annotations.map((annotation) => {
        const x = xFor(Date.parse(annotation.ts), startMs, span, width);
        return <line key={`${annotation.ts}:${annotation.targetId}`} x1={x} x2={x} y1="10" y2={height - 10} className="history-marker" stroke="currentColor" strokeDasharray="4 4" opacity="0.6" />;
      })}
    </svg>
  );
}

function activateAnnotation(annotation: ResourceHistoryAnnotation, onHighlightTarget?: (target: string) => void) {
  const target = `${annotation.targetKind}:${annotation.targetId}`;
  document.querySelector(`[data-resource-target="${target}"]`)?.scrollIntoView({ block: 'center' });
  onHighlightTarget?.(target);
}

function pointsFor(points: ResourceHistorySnapshot['cpu'], startMs: number, span: number, width: number, height: number, scale: number) {
  return points.map((point) => {
    const x = xFor(Date.parse(point.ts), startMs, span, width);
    const y = height - Math.max(0, Math.min(100, point.value)) * scale * (height / 100);
    return `${x},${y}`;
  }).join(' ');
}

function xFor(ms: number, startMs: number, span: number, width: number) {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(width, ((ms - startMs) / span) * width));
}

function emptyHistory(): ResourceHistorySnapshot {
  return { startedAt: new Date().toISOString(), cpu: [], mem: [], annotations: [] };
}

function normalizeHistory(value: Partial<ResourceHistorySnapshot>): ResourceHistorySnapshot {
  return {
    startedAt: value.startedAt ?? new Date().toISOString(),
    cpu: Array.isArray(value.cpu) ? value.cpu : [],
    mem: Array.isArray(value.mem) ? value.mem : [],
    annotations: Array.isArray(value.annotations) ? value.annotations : [],
  };
}
