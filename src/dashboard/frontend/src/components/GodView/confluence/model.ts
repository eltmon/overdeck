import type { DerivedIssueStateName, IssueAttention } from '../../../types';

export const STAGES = ['PLAN', 'WORK', 'REVIEW', 'TEST', 'MERGE'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_COLORS: Record<Stage, string> = {
  PLAN: '#00d4ff',
  WORK: '#39ff14',
  REVIEW: '#ffb800',
  TEST: '#ff2d7c',
  MERGE: '#e8edf8',
};

export const ROLE_COLORS = {
  plan: '#00d4ff',
  work: '#39ff14',
  // PAN-3920: a registered worker (pan worker run), a lighter shade of work.
  worker: '#a8ff8a',
  review: '#ffb800',
  test: '#ff2d7c',
  ship: '#e8edf8',
  flywheel: '#9d4edd',
  strike: '#ff7700',
  sequencer: '#7a8aaa',
  knowledge: '#9d4edd',
  conversation: '#00d4ff',
} as const;

export const PROJECT_RING = {
  overdeck: '#00d4ff',
  myn: '#ff2d7c',
} as const;

export const HOOKS = {
  tool_read: { color: '#00d4ff', label: 'Read/Grep', tools: ['Read', 'Grep', 'Glob'] },
  tool_write: { color: '#ffb800', label: 'Edit/Write', tools: ['Edit', 'Write', 'NotebookEdit'] },
  tool_exec: { color: '#39ff14', label: 'Bash', tools: ['Bash', 'Task Create'] },
  tool_web: { color: '#4aa8ff', label: 'Web', tools: ['WebFetch', 'WebSearch'] },
  tool_agent: { color: '#9d4edd', label: 'Subagent', tools: ['Agent', 'SendMessage'] },
  lifecycle: {
    color: '#e8edf8',
    label: 'Lifecycle',
    tools: ['Stop', 'Notification', 'UserPromptSubmit', 'PreCompact', 'SessionStart'],
  },
} as const;

export type HookFamilyKey = keyof typeof HOOKS;
export const HOOK_KEYS = Object.keys(HOOKS) as HookFamilyKey[];

export function hashStr(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function hexA(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

export function fmtAge(minutes: number): string {
  if (!minutes) return '—';
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function fmtTokens(tokens: number): string {
  return tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1e3)}k`;
}

export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
  let total = 0;
  for (const item of items) total += weight(item);

  let remaining = Math.random() * total;
  for (const item of items) {
    remaining -= weight(item);
    if (remaining <= 0) return item;
  }
  return items[items.length - 1];
}

export interface LayoutRect {
  padX: number;
  riverTop: number;
  riverBottom: number;
  doldrumsH: number;
  shelfH: number;
  colW: number;
  shelfY: number;
  doldrumsY: number;
  portalX: number;
  sunX: number;
  sunY: number;
  shelfTop: number;
  shelfBottom: number;
  shelfHeaderY: number;
  shelfLabelY: number;
  shelfReasonY: number;
  doldrumsTop: number;
  doldrumsBottom: number;
  doldrumsHeaderY: number;
  doldrumsUpperY: number;
  doldrumsLowerY: number;
  doldrumsUpperLabelY: number;
  doldrumsLowerLabelY: number;
}

/** Reserved below the Doldrums for the bottom HUD overlays (PAN-4523 D2). */
const HUD_GUTTER = 32;
const DOLDRUMS_H = 96;
const SHELF_H = 70;
/** Gap between the shelf band's bottom and the doldrums band's top. */
const BAND_GAP = 10;

export function computeLayout(width: number, height: number): LayoutRect {
  const padX = 26;
  const riverTop = 92;

  const doldrumsBottom = height - HUD_GUTTER;
  const doldrumsTop = doldrumsBottom - DOLDRUMS_H;
  const doldrumsY = doldrumsTop + 48;
  const doldrumsHeaderY = doldrumsTop + 11;
  const doldrumsUpperLabelY = doldrumsTop + 26;
  const doldrumsUpperY = doldrumsTop + 44;
  const doldrumsLowerY = doldrumsTop + 62;
  const doldrumsLowerLabelY = doldrumsTop + 88;

  const shelfBottom = doldrumsTop - BAND_GAP;
  const shelfTop = shelfBottom - SHELF_H;
  const shelfHeaderY = shelfTop + 11;
  const shelfLabelY = shelfTop + 26;
  const shelfY = shelfTop + 44;
  const shelfReasonY = shelfTop + 68;

  return {
    padX,
    riverTop,
    riverBottom: shelfTop - 12,
    doldrumsH: DOLDRUMS_H,
    shelfH: SHELF_H,
    colW: (width - padX * 2) / STAGES.length,
    shelfY,
    doldrumsY,
    portalX: width - padX - 8,
    sunX: 64,
    sunY: 52,
    shelfTop,
    shelfBottom,
    shelfHeaderY,
    shelfLabelY,
    shelfReasonY,
    doldrumsTop,
    doldrumsBottom,
    doldrumsHeaderY,
    doldrumsUpperY,
    doldrumsLowerY,
    doldrumsUpperLabelY,
    doldrumsLowerLabelY,
  };
}

export type OrbState = 'active' | 'shelf' | 'stale' | 'failed';

/**
 * Parked-orbit identity (PAN-3485 / PAN-3490). One color per orbit so the
 * Doldrums reads at a glance: slate = operator-owned, ash = dead session,
 * ice = alive but not moving. The beam effect is keyed off SWEEP_BEAM_COLOR so
 * the lantern light never collides with the governor tide's amber. The orbits
 * are exactly PARKED_ORBITS in src/lib/parked/resolver.ts.
 */
export const PARKED_ORBIT_COLORS: Record<string, string> = {
  'operator-gate': '#7a8aaa',
  'zombie-session': '#8a97a8',
  'idle-running': '#bfe3ff',
};

export function parkedOrbitColor(orbit: string | null | undefined): string {
  return (orbit && PARKED_ORBIT_COLORS[orbit]) || '#bfe3ff';
}

/** Short orbit tag for orb labels — "zombie", not "zombie-session". */
export function parkedOrbitTag(orbit: string | null | undefined): string | null {
  if (!orbit) return null;
  return orbit.replace(/-(session|running|gate)$/u, '');
}

export const SWEEP_BEAM_COLOR = '#bfe3ff';
export const SWEEP_FLARE_COLOR = '#ffd75e';

/** The pause merge-agent.ts writes after a merge (src/lib/cloister/merge-agent.ts,
 * grep "awaiting close-out"). Duplicated as a string: the frontend cannot import src/lib. */
export const CLOSE_OUT_PAUSE_REASON = 'awaiting close-out (verify on main)';

export interface RiverOrbInput {
  paused?: boolean | null;
  yieldedByScheduler?: boolean | null;
  /** The derived issue state's attention signal (FR-6). */
  attention?: IssueAttention | null;
  lastActivity?: string | number | null;
  /** The issue's derived pipeline state (PAN-4523 D6): a merged issue paused only
   * for close-out has nothing left to stall on and must exit through MERGE. */
  issueState?: DerivedIssueStateName | null;
  /** The pause reason that should speak for the issue (PAN-4523 D7). */
  pausedReason?: string | null;
}

export const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Precedence: merged-close-out-exit > shelf > failed > stale > active. A merged
 * issue whose only pause is the close-out pause has nothing left to stall on —
 * the merge exit (MERGE stage, state 'active') is the only correct way off the
 * river, so this branch returns 'active' outright rather than merely skipping
 * the shelf check (which would otherwise let the stale branch catch it).
 */
export function classifyOrb(input: RiverOrbInput, now: number): OrbState {
  if (
    input.issueState === 'merged'
    && input.yieldedByScheduler !== true
    && (input.paused !== true || input.pausedReason === CLOSE_OUT_PAUSE_REASON)
  ) return 'active';
  if (input.paused === true || input.yieldedByScheduler === true) return 'shelf';
  if (input.attention === 'stuck' || input.attention === 'api-error') return 'failed';

  const lastActivity = typeof input.lastActivity === 'number'
    ? input.lastActivity
    : input.lastActivity
      ? Date.parse(input.lastActivity)
      : Number.NaN;
  if (Number.isFinite(lastActivity) && now - lastActivity >= STALE_AFTER_MS) return 'stale';
  return 'active';
}

export interface PositionableOrb {
  id: string;
  stage: string;
  state: OrbState;
  tx: number;
  ty: number;
}

function stageIdx(stage: string): number {
  const index = STAGES.indexOf(stage as Stage);
  return index < 0 ? 1 : index;
}

function layoutWidth(layout: LayoutRect): number {
  return layout.colW * STAGES.length + layout.padX * 2;
}

export function positionOrb<T extends PositionableOrb>(
  orb: T,
  orbs: readonly T[],
  layout: LayoutRect,
  expectedStale: number,
  expectedShelf: number,
): T {
  const width = layoutWidth(layout);

  if (orb.state === 'stale') {
    const index = Math.max(0, orbs.filter((candidate) => candidate.state === 'stale').indexOf(orb));
    orb.tx = layout.padX + 70 + (index / expectedStale) * (width * 0.72 - layout.padX);
    orb.ty = index % 2 ? layout.doldrumsLowerY : layout.doldrumsUpperY;
    return orb;
  }

  if (orb.state === 'failed') {
    orb.tx = layout.portalX - 52 - (hashStr(orb.id) % 3) * 34;
    orb.ty = layout.riverTop + 50
      + (hashStr(orb.id) % Math.max(40, layout.riverBottom - layout.riverTop - 120));
    return orb;
  }

  if (orb.state === 'shelf') {
    const index = Math.max(0, orbs.filter((candidate) => candidate.state === 'shelf').indexOf(orb));
    orb.tx = layout.padX + 140
      + (index / Math.max(1, expectedShelf - 1 || 1)) * (width * 0.7);
    orb.ty = layout.shelfY;
    return orb;
  }

  const column = stageIdx(orb.stage);
  const jitter = ((hashStr(orb.id) % 100) / 100 - 0.5) * layout.colW * 0.45;
  orb.tx = layout.padX + (column + 0.5) * layout.colW + jitter;
  const laneCount = orbs.filter(
    (candidate) => candidate !== orb && candidate.stage === orb.stage && candidate.state === 'active',
  ).length;
  orb.ty = layout.riverTop + 40
    + ((hashStr(orb.id) + laneCount * 53) % Math.max(60, layout.riverBottom - layout.riverTop - 80));
  return orb;
}

/** Margin subtracted from the raw neighbour spacing when sizing a text slot. */
export const SLOT_MARGIN = 12;

/**
 * Longest prefix of `text` (plus '…' when cut) whose measured width fits
 * `maxWidth`. Returns `text` unchanged when it already fits, and '' when even
 * '…' alone does not fit.
 */
export function fitText(text: string, maxWidth: number, measure: (value: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  if (measure('…') > maxWidth) return '';

  let prefix = text;
  while (prefix.length > 0 && measure(`${prefix}…`) > maxWidth) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}…`;
}

/** Text width allotted to one shelf orb: neighbour spacing minus SLOT_MARGIN. */
export function shelfSlotWidth(layout: LayoutRect, shelfCount: number): number {
  const width = layoutWidth(layout);
  const spacing = shelfCount <= 1 ? width * 0.7 : (width * 0.7) / (shelfCount - 1);
  return spacing - SLOT_MARGIN;
}

/** Text width allotted to one stale orb: same-row neighbour spacing (two stale steps) minus SLOT_MARGIN. */
export function staleSlotWidth(layout: LayoutRect, staleCount: number): number {
  const width = layoutWidth(layout);
  return (2 * (width * 0.72 - layout.padX)) / Math.max(1, staleCount) - SLOT_MARGIN;
}

export interface PickableOrb {
  x: number;
  y: number;
  radius: number;
}

export function acquireRadius(orb: PickableOrb): number {
  return Math.max(18, orb.radius * 1.9);
}

export function dropRadius(orb: PickableOrb): number {
  return Math.max(52, orb.radius * 4.2);
}

export function pickOrb<T extends PickableOrb>(orbs: readonly T[], x: number, y: number): T | null {
  for (let index = orbs.length - 1; index >= 0; index--) {
    const orb = orbs[index];
    if (!orb) continue;
    const radius = acquireRadius(orb);
    const dx = x - orb.x;
    const dy = y - orb.y;
    if (dx * dx + dy * dy < radius * radius) return orb;
  }
  return null;
}

export function toolToFamily(toolName: string): HookFamilyKey {
  for (const family of HOOK_KEYS) {
    if ((HOOKS[family].tools as readonly string[]).includes(toolName)) return family;
  }
  return 'lifecycle';
}

export function modelGlyph(model: string | null | undefined): string | null {
  if (!model) return null;
  const normalized = String(model).toLowerCase();
  if (normalized.includes('sonnet')) return 'S';
  if (normalized.includes('gpt')) return 'G';
  if (normalized.includes('opus')) return 'O';
  if (normalized.includes('fable')) return 'F';
  if (normalized.includes('k3') || normalized.includes('kimi')) return 'K';
  return '?';
}

export const FROST_IDLE_RATE = 2;
export const FROST_START_MINUTES = 8;
export const FROST_SPAN_MINUTES = 26;
export const FROST_SINK_HOLD_SECONDS = 6;

export function frostFromIdleMinutes(idleMinutes: number): number {
  return clamp((idleMinutes - FROST_START_MINUTES) / FROST_SPAN_MINUTES, 0, 1);
}

export interface FrostAccrual {
  idleMinutes: number;
  frost: number;
  frostHoldSeconds: number;
  sinkToDoldrums: boolean;
}

export function advanceFrostAccrual(
  idleMinutes: number,
  frostHoldSeconds: number,
  elapsedSeconds: number,
): FrostAccrual {
  const nextIdleMinutes = idleMinutes + elapsedSeconds * FROST_IDLE_RATE;
  const frost = frostFromIdleMinutes(nextIdleMinutes);
  const nextFrostHoldSeconds = frost >= 1 ? frostHoldSeconds + elapsedSeconds : 0;
  return {
    idleMinutes: nextIdleMinutes,
    frost,
    frostHoldSeconds: nextFrostHoldSeconds,
    sinkToDoldrums: nextFrostHoldSeconds > FROST_SINK_HOLD_SECONDS,
  };
}

export const TRACE_WINDOW_MS = 60_000;
export const TRACE_ROW_BUCKET_PX = 2;
export const TRACE_SECONDS = 60;
export const TRACE_AUTOSCALE_FLOOR = 5;

export interface TraceEvent {
  name: string;
  t: number;
}

export function traceTimeToX(
  timestamp: number,
  now: number,
  left: number,
  right: number,
  windowMs = TRACE_WINDOW_MS,
): number {
  return right - ((now - timestamp) / windowMs) * (right - left);
}

export function bucketTraceRow(
  events: readonly TraceEvent[],
  hookName: string,
  now: number,
  left: number,
  right: number,
  bucketWidth = TRACE_ROW_BUCKET_PX,
): number[] {
  const bucketCount = Math.ceil((right - left) / bucketWidth);
  if (bucketCount <= 0) return [];

  const buckets = new Array<number>(bucketCount).fill(0);
  for (const event of events) {
    if (event.name !== hookName) continue;
    const x = traceTimeToX(event.t, now, left, right);
    if (x < left) continue;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((x - left) / bucketWidth)));
    buckets[index] += 1;
  }
  return buckets;
}

export interface TraceAggregate {
  buckets: number[];
  maxBucket: number;
}

export function aggregateTracePerSecond(events: readonly TraceEvent[], now: number): TraceAggregate {
  const buckets = new Array<number>(TRACE_SECONDS).fill(0);
  for (const event of events) {
    const ageSeconds = Math.floor((now - event.t) / 1000);
    if (ageSeconds >= 0 && ageSeconds < TRACE_SECONDS) {
      buckets[TRACE_SECONDS - 1 - ageSeconds] += 1;
    }
  }
  return {
    buckets,
    maxBucket: Math.max(TRACE_AUTOSCALE_FLOOR, ...buckets),
  };
}

export function pruneTraceEvents(
  events: readonly TraceEvent[],
  now: number,
  windowMs = TRACE_WINDOW_MS,
): TraceEvent[] {
  const cutoff = now - windowMs;
  return events.filter((event) => event.t >= cutoff);
}
