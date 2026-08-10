import { useEffect, useRef, useState } from 'react';
import { Maximize2, Zap } from 'lucide-react';
import { fmtAge, fmtTokens } from './confluence/model';
import type { ConfluenceData } from './confluence/useConfluenceData';

interface TopBarProps {
  data: ConfluenceData;
  onHelpToggle: () => void;
  onFullscreenToggle: () => void;
}

const ECG_SAMPLE_COUNT = 130;
const ECG_INTERVAL_MS = 500;

function SystemClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="confluence-clock gv-mono">{now.toLocaleTimeString('en-US', { hour12: false })}</span>;
}

export function appendEcgSample(samples: readonly number[], value: number): number[] {
  return [...samples.slice(-(ECG_SAMPLE_COUNT - 1)), value];
}

function drawEcg(canvas: HTMLCanvasElement, samples: readonly number[]): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(57, 255, 20, .2)';
  context.beginPath();
  for (let x = 0; x <= canvas.width; x += 10) {
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
  }
  context.stroke();

  const peak = Math.max(5, ...samples);
  context.strokeStyle = '#39ff14';
  context.lineWidth = 1.5;
  context.beginPath();
  samples.forEach((sample, index) => {
    const x = samples.length <= 1 ? canvas.width : index / (samples.length - 1) * canvas.width;
    const y = canvas.height - Math.min(1, sample / peak) * (canvas.height - 3) - 1.5;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function EventsEcg({ eventsPerMin }: { eventsPerMin: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valueRef = useRef(eventsPerMin);
  const samplesRef = useRef<number[]>(Array.from({ length: ECG_SAMPLE_COUNT }, () => 0));
  valueRef.current = eventsPerMin;

  useEffect(() => {
    const sample = () => {
      samplesRef.current = appendEcgSample(samplesRef.current, valueRef.current);
      if (canvasRef.current) drawEcg(canvasRef.current, samplesRef.current);
    };
    sample();
    const timer = setInterval(sample, ECG_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return <canvas ref={canvasRef} className="confluence-ecg" width={130} height={30} aria-label="Events per minute ECG" />;
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const bounded = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="confluence-meter" data-label={label}>
      <i><b style={{ width: `${bounded}%` }} /></i>
      <em>{label} {value == null ? '—' : `${Math.round(value)}%`}</em>
    </span>
  );
}

function Stat({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return <span className="confluence-stat" title={title}><em>{label}</em><b>{value}</b></span>;
}

export function GodViewTopBar({ data, onHelpToggle, onFullscreenToggle }: TopBarProps) {
  const { hookStream, meta } = data;
  const [eventsPop, setEventsPop] = useState(false);
  const previousEvents = useRef(hookStream.eventsPerSec);

  useEffect(() => {
    if (previousEvents.current === hookStream.eventsPerSec) return;
    previousEvents.current = hookStream.eventsPerSec;
    setEventsPop(true);
    const timer = setTimeout(() => setEventsPop(false), 220);
    return () => clearTimeout(timer);
  }, [hookStream.eventsPerSec]);

  const system = meta.system;
  const swap = system?.summary.swapUsedPercent ?? null;
  const load = system?.summary.loadAverage1m ?? null;
  const beads = meta.beads;

  return (
    <div className="confluence-topbar gv-glass">
      <div className="confluence-brand">
        <Zap aria-hidden="true" />
        <span>God View</span>
      </div>
      <SystemClock />
      <Stat label="EV/S" value={hookStream.eventsPerSec.toFixed(1)} />
      <span className={`confluence-event-pop ${eventsPop ? 'pop' : ''}`} aria-hidden="true" />
      <span className="confluence-ecg-stat">
        <EventsEcg eventsPerMin={hookStream.eventsPerMin} />
        <Stat label="EV/M" value={hookStream.eventsPerMin} />
      </span>
      <Stat
        label="VEL"
        value={meta.velocity ? `${meta.velocity.transitionsPerHour}/h` : '—'}
        title={meta.velocity
          ? `real stage transitions in the last hour — plan ${meta.velocity.byStage['plan'] ?? 0} · work ${meta.velocity.byStage['work'] ?? 0} · review ${meta.velocity.byStage['review'] ?? 0} · test ${meta.velocity.byStage['test'] ?? 0} · verify ${meta.velocity.byStage['verify'] ?? 0} · merge ${meta.velocity.byStage['merge'] ?? 0}`
          : 'velocity unavailable'}
      />
      <span className="confluence-meters">
        <Meter label="CPU" value={system?.cpu ?? null} />
        <Meter label="MEM" value={system?.memPercent ?? null} />
        <Meter label="SWAP" value={swap} />
      </span>
      <Stat label="LOAD" value={load == null ? '—' : load.toFixed(2)} />
      <Stat label="WIP" value={beads?.wip ?? '—'} />
      <Stat label="BLOCKED" value={beads?.blocked ?? '—'} />
      <Stat label="READY" value={beads?.ready ?? '—'} />
      <Stat label="MERGE Q" value={meta.mergeQ} />
      <Stat label="$/MIN" value={meta.costPerMin == null ? '—' : `$${meta.costPerMin.toFixed(2)}`} />
      <Stat label="MERGES" value={meta.mergesToday} />
      <Stat label="TOKENS" value={meta.tokensToday == null ? '—' : fmtTokens(meta.tokensToday)} />
      <Stat label="❄ STALE" value={meta.staleTotal} />
      <Stat label="🧹 PARKED" value={meta.parkedTotal ?? '—'} />
      <Stat label="OLDEST" value={meta.total === 0 ? '—' : fmtAge(meta.oldestIdle)} />
      <span className={`confluence-active ${meta.active > 0 ? 'on' : ''}`}>{meta.active} active</span>
      <button
        type="button"
        className="confluence-topbar-button"
        onClick={onHelpToggle}
        aria-label="Open Confluence field guide"
      >
        ? HELP
      </button>
      <button
        type="button"
        className="confluence-topbar-button icon"
        onClick={onFullscreenToggle}
        aria-label="Toggle God View fullscreen"
      >
        <Maximize2 aria-hidden="true" />
      </button>
    </div>
  );
}
