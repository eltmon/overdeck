import { useEffect, useRef } from 'react';
import { WIRED_HOOK_INVENTORY } from '@overdeck/contracts';
import { hexA, ROLE_COLORS } from './model';
import type { HookStreamEntry } from './useConfluenceData';

export const TRACE_WINDOW_MS = 60_000;
export const TRACE_GUTTER = 128;
export const TRACE_AGGREGATE_BAND_HEIGHT = 22;
export const TRACE_AXIS_HEIGHT = 11;
const TRACE_ROW_GAP = 3;
const TRACE_BUCKET_WIDTH = 2;
const TRACE_SECONDS = 60;

interface TraceMark {
  bucket: number;
  count: number;
  alpha: number;
}

export function traceTickAlpha(count: number): number {
  return Math.min(1, .45 + count * .22);
}

export function traceTickHeight(count: number, rowHeight: number): number {
  return Math.min(rowHeight - 2, 2.5 + count * 1.8);
}

interface TraceChannel {
  name: string;
  color: string;
  count: number;
  dim: number;
  marks: readonly TraceMark[];
}

export interface TraceFrame {
  events: readonly HookStreamEntry[];
  aggregateBuckets: readonly number[];
  aggregateCurrent: number;
  aggregatePeak: number;
  channels: readonly TraceChannel[];
}

interface BottomStripProps {
  entries: readonly HookStreamEntry[];
  roleCounts: Readonly<Record<string, number>>;
}

export function buildTraceFrame(
  entries: readonly HookStreamEntry[],
  now: number,
  plotWidth: number,
): TraceFrame {
  const wiredNames = new Set<string>(WIRED_HOOK_INVENTORY.map((hook) => hook.name));
  const events = entries.filter((entry) => {
    const age = now - entry.ts;
    return entry.source === 'hook'
      && wiredNames.has(entry.hookName)
      && age >= 0
      && age <= TRACE_WINDOW_MS;
  });
  const aggregateBuckets = Array.from({ length: TRACE_SECONDS }, () => 0);
  for (const event of events) {
    const ageSeconds = Math.floor((now - event.ts) / 1_000);
    if (ageSeconds < TRACE_SECONDS) aggregateBuckets[TRACE_SECONDS - 1 - ageSeconds]++;
  }

  const bucketCount = Math.max(1, Math.ceil(plotWidth / TRACE_BUCKET_WIDTH));
  const channels = WIRED_HOOK_INVENTORY.map((hook) => {
    const rowBuckets = new Float32Array(bucketCount);
    let count = 0;
    for (const event of events) {
      if (event.hookName !== hook.name) continue;
      count++;
      const x = plotWidth - ((now - event.ts) / TRACE_WINDOW_MS) * plotWidth;
      const bucket = Math.min(bucketCount - 1, Math.max(0, Math.floor(x / TRACE_BUCKET_WIDTH)));
      rowBuckets[bucket]++;
    }
    const marks: TraceMark[] = [];
    rowBuckets.forEach((burstCount, bucket) => {
      if (!burstCount) return;
      marks.push({
        bucket,
        count: burstCount,
        alpha: traceTickAlpha(burstCount),
      });
    });
    return {
      name: hook.name,
      color: hook.color,
      count,
      dim: count ? 1 : .38,
      marks,
    };
  });

  return {
    events,
    aggregateBuckets,
    aggregateCurrent: aggregateBuckets[TRACE_SECONDS - 1] ?? 0,
    aggregatePeak: Math.max(5, ...aggregateBuckets),
    channels,
  };
}

export function drawTrace(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  entries: readonly HookStreamEntry[],
  now: number,
  animationTimeSeconds: number,
): void {
  context.clearRect(0, 0, width, height);
  const gutter = TRACE_GUTTER;
  const axisH = TRACE_AXIS_HEIGHT;
  const bandH = TRACE_AGGREGATE_BAND_HEIGHT;
  const gap = TRACE_ROW_GAP;
  const px0 = gutter;
  const px1 = width - 6;
  const plotWidth = Math.max(1, px1 - px0);
  const rowsY0 = bandH + gap;
  const rowsH = height - rowsY0 - axisH;
  const rowH = rowsH / WIRED_HOOK_INVENTORY.length;
  const frame = buildTraceFrame(entries, now, plotWidth);

  context.font = '600 6.5px "JetBrains Mono"';
  context.textAlign = 'center';
  for (let seconds = 10; seconds < 60; seconds += 10) {
    const x = px1 - (seconds / 60) * plotWidth;
    context.strokeStyle = 'rgba(0,212,255,.07)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, 2);
    context.lineTo(x, height - axisH + 2);
    context.stroke();
    context.fillStyle = 'rgba(74,90,122,.9)';
    context.fillText(`-${seconds}s`, x, height - 2);
  }
  const nowPulse = .6 + .4 * Math.sin(animationTimeSeconds * 4);
  context.strokeStyle = `rgba(0,212,255,${.25 + nowPulse * .3})`;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(px1, 2);
  context.lineTo(px1, height - axisH + 2);
  context.stroke();
  context.fillStyle = 'rgba(0,212,255,.8)';
  context.fillText('now', px1 - 4, height - 2);
  context.textAlign = 'left';

  context.beginPath();
  context.moveTo(px0, bandH);
  frame.aggregateBuckets.forEach((bucket, index) => {
    const x = px0 + (index / (TRACE_SECONDS - 1)) * plotWidth;
    context.lineTo(x, bandH - (bucket / frame.aggregatePeak) * (bandH - 3));
  });
  context.lineTo(px1, bandH);
  context.closePath();
  context.fillStyle = 'rgba(0,212,255,.10)';
  context.fill();
  context.beginPath();
  frame.aggregateBuckets.forEach((bucket, index) => {
    const x = px0 + (index / (TRACE_SECONDS - 1)) * plotWidth;
    const y = bandH - (bucket / frame.aggregatePeak) * (bandH - 3);
    if (index) context.lineTo(x, y);
    else context.moveTo(x, y);
  });
  context.strokeStyle = 'rgba(0,212,255,.75)';
  context.lineWidth = 1.3;
  context.shadowColor = 'rgba(0,212,255,.6)';
  context.shadowBlur = 4;
  context.stroke();
  context.shadowBlur = 0;
  context.font = '600 7px "JetBrains Mono"';
  context.fillStyle = 'rgba(122,138,170,.9)';
  context.fillText('TOTAL', 4, bandH - 13);
  context.fillStyle = 'rgba(0,212,255,.95)';
  context.fillText(`${frame.aggregateCurrent} ev/s · peak ${frame.aggregatePeak}`, 4, bandH - 4);

  frame.channels.forEach((channel, row) => {
    const y0 = rowsY0 + row * rowH;
    const centerY = y0 + rowH / 2;
    context.strokeStyle = 'rgba(30,38,56,.5)';
    context.beginPath();
    context.moveTo(px0, y0 + rowH);
    context.lineTo(px1, y0 + rowH);
    context.stroke();
    context.globalAlpha = channel.dim;
    context.fillStyle = channel.color;
    context.fillRect(4, centerY - 2.5, 5, 5);
    context.font = '600 7px "JetBrains Mono"';
    context.fillStyle = '#bfe9ff';
    context.fillText(channel.name, 13, centerY + 2.5);
    context.textAlign = 'right';
    context.fillStyle = channel.count ? '#e8edf8' : '#4a5a7a';
    context.fillText(`${channel.count}/m`, gutter - 8, centerY + 2.5);
    context.textAlign = 'left';
    context.globalAlpha = 1;
    context.strokeStyle = hexA(channel.color, .10 + (channel.count ? .08 : 0));
    context.beginPath();
    context.moveTo(px0, centerY);
    context.lineTo(px1, centerY);
    context.stroke();
    for (const mark of channel.marks) {
      const tickHeight = traceTickHeight(mark.count, rowH);
      context.globalAlpha = mark.alpha;
      context.fillStyle = channel.color;
      context.shadowColor = channel.color;
      context.shadowBlur = 3;
      context.fillRect(px0 + mark.bucket * TRACE_BUCKET_WIDTH, centerY - tickHeight / 2, 1.6, tickHeight);
    }
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  });
}

export function BottomStrip({ entries, roleCounts }: BottomStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * ratio);
      canvas.height = Math.floor(canvas.clientHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    let frame = 0;
    const renderFrame = (time: number) => {
      drawTrace(context, canvas.clientWidth, canvas.clientHeight, entriesRef.current, Date.now(), time / 1_000);
      frame = requestAnimationFrame(renderFrame);
    };
    frame = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <footer className="confluence-bottom">
      <div className="confluence-trace gv-glass">
        <canvas ref={canvasRef} aria-label="Hook telemetry trace" />
      </div>
      <div className="confluence-roles gv-glass" aria-label="Agent role counts">
        {Object.entries(roleCounts).map(([role, count]) => (
          <span key={role}>
            <i style={{ background: ROLE_COLORS[role as keyof typeof ROLE_COLORS] ?? 'var(--gv-blue)' }} />
            {role}
            <b>{count}</b>
          </span>
        ))}
      </div>
    </footer>
  );
}
