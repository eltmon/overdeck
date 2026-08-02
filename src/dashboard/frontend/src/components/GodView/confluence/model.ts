export const STAGES = ['PLAN', 'WORK', 'REVIEW', 'TEST', 'VERIFY', 'MERGE'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_COLORS: Record<Stage, string> = {
  PLAN: '#00d4ff',
  WORK: '#39ff14',
  REVIEW: '#ffb800',
  TEST: '#ff2d7c',
  VERIFY: '#9d4edd',
  MERGE: '#e8edf8',
};

export const ROLE_COLORS = {
  plan: '#00d4ff',
  work: '#39ff14',
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
  tool_read: { color: '#00d4ff', label: 'Read/Grep', tools: ['Read', 'Grep', 'Glob', 'TLDR'] },
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
  spectrumH: number;
  doldrumsH: number;
  shelfH: number;
  colW: number;
  shelfY: number;
  doldrumsY: number;
  portalX: number;
  sunX: number;
  sunY: number;
}

export function computeLayout(width: number, height: number): LayoutRect {
  const padX = 26;
  const riverTop = 92;
  const spectrumH = 54;
  const doldrumsH = 64;
  const shelfH = 34;

  return {
    padX,
    riverTop,
    spectrumH,
    doldrumsH,
    shelfH,
    riverBottom: height - spectrumH - doldrumsH - shelfH - 14,
    colW: (width - padX * 2) / STAGES.length,
    shelfY: height - spectrumH - doldrumsH - shelfH + shelfH / 2 - 6,
    doldrumsY: height - spectrumH - doldrumsH + doldrumsH / 2 - 4,
    portalX: width - padX - 8,
    sunX: 64,
    sunY: 52,
  };
}

export type OrbState = 'active' | 'shelf' | 'stale' | 'failed';

/**
 * Parked-orbit identity (PAN-3485 / PAN-3490). One color per orbit so the
 * Doldrums reads at a glance: amber family = operator-owned, hot colors =
 * mechanical failures the sweeper acts on, ice = stale-but-living, ash =
 * residue to reap. The beam effect is keyed off SWEEP_BEAM_COLOR so the
 * lantern light never collides with the governor tide's amber.
 */
export const PARKED_ORBIT_COLORS: Record<string, string> = {
  'stuck-flag': '#ffb800',
  'needs-you': '#ffd75e',
  'deacon-ignored': '#5a6478',
  'operator-gate': '#7a8aaa',
  'uat-failed': '#ff7700',
  'merge-failed': '#ff2d7c',
  conflicts: '#9d4edd',
  'zombie-session': '#8a97a8',
  'idle-running': '#bfe3ff',
  'circuit-breaker': '#ff4444',
};

export function parkedOrbitColor(orbit: string | null | undefined): string {
  return (orbit && PARKED_ORBIT_COLORS[orbit]) || '#bfe3ff';
}

/** Short orbit tag for orb labels — "stuck", not "stuck-flag". */
export function parkedOrbitTag(orbit: string | null | undefined): string | null {
  if (!orbit) return null;
  return orbit.replace(/-(flag|failed|session|running|breaker|gate|ignored|you)$/u, '');
}

export const SWEEP_BEAM_COLOR = '#bfe3ff';
export const SWEEP_FLARE_COLOR = '#ffd75e';

export interface RiverOrbInput {
  paused?: boolean | null;
  yieldedByScheduler?: boolean | null;
  mergeStatus?: string | null;
  lastActivity?: string | number | null;
}

export const STALE_AFTER_MS = 30 * 60 * 1000;

export function classifyOrb(input: RiverOrbInput, now: number): OrbState {
  if (input.paused === true || input.yieldedByScheduler === true) return 'shelf';
  if (input.mergeStatus === 'failed') return 'failed';

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
    orb.ty = layout.doldrumsY + (index % 2 ? 13 : -11);
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
      + (index / Math.max(1, expectedShelf - 1 || 1)) * (width * 0.5);
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
