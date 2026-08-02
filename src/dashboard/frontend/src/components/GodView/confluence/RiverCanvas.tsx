import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createAurora, type AuroraController } from './aurora';
import { resolveHoverOrb } from './OrbTooltip';
import {
  PROJECT_RING,
  ROLE_COLORS,
  STAGES,
  STAGE_COLORS,
  SWEEP_BEAM_COLOR,
  SWEEP_FLARE_COLOR,
  advanceFrostAccrual,
  clamp,
  fmtAge,
  hexA,
  modelGlyph,
  parkedOrbitColor,
  parkedOrbitTag,
  pickOrb,
  positionOrb,
  type LayoutRect,
  type Stage,
} from './model';
import type {
  ConfluenceConvoyMember,
  ConfluenceHookStream,
  ConfluenceOrb,
} from './useConfluenceData';

const ICE = '#bfe3ff';
const PARTICLE_LIMIT = 1600;
const TICKER_LIMIT = 6;
const SAT_LETTERS: Record<string, string> = {
  security: 'S', correctness: 'C', performance: 'P', requirements: 'R', synthesis: 'Σ', supervisor: '◎', lead: 'L',
};

interface Satellite extends ConfluenceConvoyMember {
  angle: number;
  heat: number;
  flash: number;
  orbitR: number;
  arriving: boolean;
  sx: number;
  sy: number;
}

interface RenderOrb extends ConfluenceOrb {
  x: number;
  y: number;
  tx: number;
  ty: number;
  radius: number;
  wobA: number;
  wobB: number;
  wobSpeed: number;
  orbitA: number;
  entering: boolean;
  merging: boolean;
  mergeVx: number;
  mergeDwell: number;
  fading: number | null;
  frost: number;
  frostHold: number;
  flashT: number;
  convoy: Satellite[] | null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  kind: 'spark' | 'frost' | 'snow' | 'dollar';
}

interface Pulse { x: number; y: number; r: number; maxR: number; color: string; alpha: number; width: number }
interface Ticker { text: string; color: string; x: number; y: number; life: number; maxLife: number }
interface GateFlash { x: number; t: number }
interface Tide { active: boolean; x: number; targetId: string | null; beneficiaryId: string | null; t: number }
/** The sweeper's lantern beam (PAN-3490): an ice-blue light that travels the
 * Doldrums band on a real population change, glinting each frozen orb it
 * passes. Distinct from the governor tide (amber, river+shelf) in color,
 * altitude, and meaning. */
interface SweepBeam { active: boolean; x: number; t: number }
/** A signal flare fired by a parked orb on sweep.escalated — rises slowly,
 * pulses, and fades after a few seconds. */
interface Flare { issueId: string; x: number; y: number; t: number }
const FLARE_LIFETIME = 8;
const FLARE_LIMIT = 8;

export interface RiverEffectsApi {
  emitSparks(issueId: string, color?: string, agentId?: string, heatBump?: number): void;
  emitRing(issueId: string, color?: string): void;
  emitTicker(text: string, color?: string): void;
  playTide(targetId?: string, beneficiaryId?: string): void;
  playMerge(issueId: string): void;
  playThaw(issueId: string): void;
  playSweep(): void;
  playFlare(issueId: string): void;
  pulseSun(): void;
  spawnFromSun(issueId: string): void;
  gateFlash(stage: Stage | number): void;
}

export interface RiverCanvasHandle extends RiverEffectsApi {
  resize(): void;
}

export interface RiverCanvasProps {
  orbs: readonly ConfluenceOrb[];
  hookStream: ConfluenceHookStream;
  selectedId?: string | null;
  conversations?: number | null;
  mergeQueue?: number;
  sequencer?: boolean;
  /** True parked census for the Doldrums label (null while /api/parked is unanswered). */
  parkedTotal?: number | null;
  onHover?: (orb: ConfluenceOrb | null, point: { x: number; y: number; canvasWidth: number } | null) => void;
  onSelect?: (orb: ConfluenceOrb | null) => void;
}

export function advanceMergeDwell(
  stage: Stage,
  mergeStatus: string | null,
  remaining: number,
  dt: number,
): { remaining: number; shouldStart: boolean } {
  if (stage !== 'MERGE') return { remaining, shouldStart: false };
  const next = Math.max(0, remaining - dt);
  return { remaining: next, shouldStart: next === 0 && mergeStatus === 'merging' };
}

export function resolveMergeReconciliation(
  sourceState: ConfluenceOrb['state'],
  hasCurrent: boolean,
  retired: boolean,
  mergeInFlight: boolean,
): { retired: boolean; cancelMerge: boolean; shouldSpawn: boolean } {
  if (sourceState === 'failed') {
    return { retired: false, cancelMerge: hasCurrent && mergeInFlight, shouldSpawn: !hasCurrent };
  }
  return { retired, cancelMerge: false, shouldSpawn: !hasCurrent && !retired };
}

interface Engine {
  api: RiverEffectsApi;
  update(props: RiverCanvasProps): void;
  resize(): void;
  dispose(): void;
  pick(x: number, y: number): RenderOrb | null;
  setPointer(x: number, y: number, inside: boolean): void;
}

function mixColor(first: string, second: string, amount: number): string {
  const a = Number.parseInt(first.slice(1), 16);
  const b = Number.parseInt(second.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * amount);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function canvasLayout(width: number, height: number): LayoutRect {
  const padX = 26;
  const riverTop = 92;
  const doldrumsH = 64;
  const shelfH = 34;
  return {
    padX,
    riverTop,
    spectrumH: 0,
    doldrumsH,
    shelfH,
    riverBottom: height - doldrumsH - shelfH - 22,
    colW: (width - padX * 2) / STAGES.length,
    shelfY: height - doldrumsH - shelfH + shelfH / 2 - 10,
    doldrumsY: height - doldrumsH + doldrumsH / 2 - 12,
    portalX: width - padX - 8,
    sunX: 64,
    sunY: 52,
  };
}

function roleColor(role: string): string {
  return ROLE_COLORS[role as keyof typeof ROLE_COLORS] ?? STAGE_COLORS.WORK;
}

function projectColor(project: string): string {
  return PROJECT_RING[project as keyof typeof PROJECT_RING] ?? STAGE_COLORS.PLAN;
}

function createSatellite(member: ConfluenceConvoyMember, index: number, total: number, arriving = false): Satellite {
  // Satellites present when the orb first renders sit in settled orbit; only a
  // member that joins an already-visible convoy spirals in from far orbit.
  // (Spawning every satellite arriving from r=210 scattered "· arriving" labels
  // across the whole canvas on first mount.)
  const baseRadius = 30 + Math.max(1, total) * 3;
  return {
    ...member,
    angle: index * (Math.PI * 2 / Math.max(1, total)),
    heat: Math.random(),
    flash: 0,
    orbitR: arriving ? 210 : baseRadius,
    arriving,
    sx: 0,
    sy: 0,
  };
}

function createEngine(
  wrap: HTMLElement,
  glCanvas: HTMLCanvasElement,
  fxCanvas: HTMLCanvasElement,
  initial: RiverCanvasProps,
): Engine | null {
  const fx = fxCanvas.getContext('2d');
  const trailCanvas = document.createElement('canvas');
  const trail = trailCanvas.getContext('2d');
  if (!fx || !trail) return null;

  const aurora: AuroraController = createAurora(glCanvas);
  const renderOrbs = new Map<string, RenderOrb>();
  const retiredIds = new Set<string>();
  const particles: Particle[] = [];
  const pulses: Pulse[] = [];
  const tickers: Ticker[] = [];
  const gateFlashes: GateFlash[] = [];
  const tide: Tide = { active: false, x: 0, targetId: null, beneficiaryId: null, t: 0 };
  const sweepBeam: SweepBeam = { active: false, x: 0, t: 0 };
  const flares: Flare[] = [];
  let props = initial;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let layout = canvasLayout(1, 1);
  let last = performance.now();
  let simT = 0;
  let frameId = 0;
  let disposed = false;
  let hoverOrb: RenderOrb | null = null;
  const pointer = { x: 0, y: 0, inside: false };

  const list = () => [...renderOrbs.values()];
  const anchorAll = () => {
    const current = list();
    const stale = Math.max(1, current.filter((orb) => orb.state === 'stale').length);
    const shelf = Math.max(1, current.filter((orb) => orb.state === 'shelf').length);
    for (const orb of current) positionOrb(orb, current, layout, stale, shelf);
  };
  const orbAt = (issueId: string) => renderOrbs.get(issueId);

  const burst = (x: number, y: number, color: string, count: number, speed: number, life: number, size: number, spread = Math.PI * 2, direction = 0) => {
    for (let index = 0; index < count && particles.length < PARTICLE_LIMIT; index++) {
      const angle = direction + (Math.random() - 0.5) * spread;
      const velocity = speed * (0.3 + Math.random() * 0.9);
      particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 0,
        maxLife: life * (0.5 + Math.random() * 0.8), color, size: size * (0.5 + Math.random()), kind: 'spark' });
    }
  };
  const frostMotes = (x: number, y: number, count: number) => {
    for (let index = 0; index < count && particles.length < PARTICLE_LIMIT; index++) {
      particles.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 8, vy: 6 + Math.random() * 10, life: 0, maxLife: 2.5 + Math.random() * 2,
        color: ICE, size: 1 + Math.random() * 1.5, kind: 'frost' });
    }
  };
  const snow = (x: number, y: number) => {
    if (particles.length >= PARTICLE_LIMIT) return;
    particles.push({ x: x + (Math.random() - 0.5) * 26, y: y - 8, vx: (Math.random() - 0.5) * 6,
      vy: 9 + Math.random() * 12, life: 0, maxLife: 1.6 + Math.random() * 1.4, color: ICE,
      size: 1 + Math.random() * 1.4, kind: 'snow' });
  };
  const dollar = (orb: RenderOrb) => {
    if (particles.length >= PARTICLE_LIMIT) return;
    particles.push({ x: orb.x + (Math.random() - 0.5) * 12, y: orb.y - 8, vx: (Math.random() - 0.5) * 10,
      vy: -(22 + Math.random() * 16), life: 0, maxLife: 1.6, color: '#ffb800', size: 9, kind: 'dollar' });
  };
  const ring = (x: number, y: number, color: string, maxR: number, lineWidth = 2) => {
    pulses.push({ x, y, r: 6, maxR, color, alpha: 0.8, width: lineWidth });
  };
  const ticker = (text: string, color: string) => {
    if (tickers.length >= TICKER_LIMIT) return;
    const riverHeight = layout.riverBottom - layout.riverTop;
    const trimmed = text.length > 48 ? `${text.slice(0, 47)}…` : text;
    tickers.push({ text: trimmed, color, x: layout.padX + 10 + Math.random() * 140,
      y: layout.riverTop + riverHeight * 0.38 + Math.random() * riverHeight * 0.4, life: 0, maxLife: 9 });
  };
  const flashGate = (stage: Stage | number) => {
    const index = typeof stage === 'number' ? stage : STAGES.indexOf(stage);
    gateFlashes.push({ x: layout.padX + Math.max(0, index) * layout.colW, t: 0 });
  };

  const spawnOrb = (source: ConfluenceOrb, fromSun = false): RenderOrb => {
    const convoy = source.convoy?.map((member, index, members) => createSatellite(member, index, members.length)) ?? null;
    const orb: RenderOrb = {
      ...source,
      glyph: source.glyph ?? modelGlyph(source.model),
      convoy,
      x: 0, y: 0, tx: 0, ty: 0,
      radius: 11 + Math.random() * 3,
      wobA: Math.random() * Math.PI * 2,
      wobB: Math.random() * Math.PI * 2,
      wobSpeed: 0.4 + Math.random() * 0.5,
      orbitA: Math.random() * Math.PI * 2,
      entering: true,
      merging: false,
      mergeVx: 0,
      mergeDwell: source.stage === 'MERGE' ? 1.5 + Math.random() * 2 : 0,
      fading: null,
      frost: 0,
      frostHold: 0,
      flashT: 0,
    };
    renderOrbs.set(orb.id, orb);
    anchorAll();
    orb.x = fromSun ? layout.sunX : orb.state === 'stale' || orb.state === 'failed' ? orb.tx : orb.tx - 60;
    orb.y = fromSun ? layout.sunY : orb.ty;
    return orb;
  };

  const startMerge = (orb: RenderOrb) => {
    if (orb.merging) return;
    orb.merging = true;
    orb.mergeVx = 2;
    orb.fading = null;
  };
  const finishMerge = (orb: RenderOrb) => {
    retiredIds.add(orb.id);
    burst(layout.portalX - 10, orb.y, '#e8edf8', 90, 160, 1.8, 3);
    ring(layout.portalX - 10, orb.y, '#39ff14', 130, 3);
    ring(layout.portalX - 10, orb.y, '#00d4ff', 90, 2);
    ticker(`${orb.id} MERGED ✓`, '#39ff14');
    renderOrbs.delete(orb.id);
  };
  const thaw = (orb: RenderOrb) => {
    orb.state = 'active';
    orb.stage = 'WORK';
    orb.staleMin = 0;
    orb.idleMin = 0;
    orb.frost = 0;
    orb.frostHold = 0;
    orb.heat = 0.8;
    anchorAll();
    burst(orb.x, orb.y, ICE, 40, 90, 1.6, 2.4);
    ring(orb.x, orb.y, '#00d4ff', 80, 2.5);
    ticker(`${orb.id} thawed`, '#00d4ff');
  };

  const api: RiverEffectsApi = {
    emitSparks(issueId, color = '#00d4ff', agentId, heatBump = 0) { const orb = orbAt(issueId); if (orb) { orb.heat = Math.min(1, orb.heat + heatBump); orb.flashT = simT + 0.8; const satellite = orb.convoy?.find((member) => member.agentId === agentId); if (satellite) satellite.flash = 1; burst(orb.x, orb.y, color, 26, 90, 1.4, 2.6); } },
    emitRing(issueId, color = '#00d4ff') { const orb = orbAt(issueId); if (orb) ring(orb.x, orb.y, color, 70, 2.5); },
    emitTicker(text, color = '#00d4ff') { ticker(text, color); },
    playTide(targetId, beneficiaryId) {
      tide.active = true; tide.x = layout.padX - 40; tide.t = 0;
      tide.targetId = targetId ?? list().find((orb) => orb.state === 'active' && orb.stage === 'WORK')?.id ?? null;
      tide.beneficiaryId = beneficiaryId ?? list().find((orb) => orb.state === 'shelf')?.id ?? null;
    },
    playMerge(issueId) { const orb = orbAt(issueId); if (orb) startMerge(orb); },
    playThaw(issueId) { const orb = orbAt(issueId); if (orb) thaw(orb); },
    playSweep() {
      sweepBeam.active = true;
      sweepBeam.x = layout.padX - 30;
      sweepBeam.t = 0;
    },
    playFlare(issueId) {
      const orb = orbAt(issueId);
      if (!orb) return;
      if (flares.length >= FLARE_LIMIT) flares.shift();
      flares.push({ issueId, x: orb.x, y: orb.y - orb.radius - 6, t: 0 });
      burst(orb.x, orb.y - orb.radius, SWEEP_FLARE_COLOR, 18, 60, 1.4, 2, Math.PI * 0.9, -Math.PI / 2);
      ring(orb.x, orb.y, SWEEP_FLARE_COLOR, 66, 2);
    },
    pulseSun() { ring(layout.sunX, layout.sunY, '#9d4edd', 90, 2.5); },
    spawnFromSun(issueId) { const source = props.orbs.find((orb) => orb.id === issueId); if (source && !orbAt(issueId)) spawnOrb(source, true); },
    gateFlash: flashGate,
  };

  const reconcile = (next: RiverCanvasProps) => {
    props = next;
    const live = new Set(next.orbs.map((orb) => orb.id));
    for (const source of next.orbs) {
      const current = orbAt(source.id);
      const mergeState = resolveMergeReconciliation(
        source.state,
        current !== undefined,
        retiredIds.has(source.id),
        current?.merging ?? false,
      );
      if (!mergeState.retired) retiredIds.delete(source.id);
      if (!current) { if (mergeState.shouldSpawn) spawnOrb(source); continue; }
      if (mergeState.cancelMerge) {
        current.merging = false;
        current.mergeVx = 0;
        current.mergeDwell = 0;
      }
      const previousStage = current.stage;
      const previousSpend = current.spend;
      const existingSatellites = new Map(current.convoy?.map((satellite) => [satellite.role, satellite]) ?? []);
      Object.assign(current, source, {
        convoy: source.convoy?.map((member, index, members) => existingSatellites.get(member.role)
          ? Object.assign(existingSatellites.get(member.role)!, member)
          : createSatellite(member, index, members.length, true)) ?? null,
        compactT: Math.max(current.compactT, source.compactT),
        fading: null,
      });
      if (source.stage !== previousStage && source.stage === 'MERGE') {
        current.mergeDwell = 1.5 + Math.random() * 2;
      }
      if (source.spend > previousSpend) dollar(current);
    }
    for (const orb of list()) {
      if (live.has(orb.id) || orb.merging || orb.fading !== null) continue;
      if (orb.stage === 'MERGE') startMerge(orb);
      else orb.fading = 1;
    }
    for (const issueId of retiredIds) if (!live.has(issueId)) retiredIds.delete(issueId);
    anchorAll();
    aurora.setEnergy(next.hookStream.energy);
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, wrap.clientWidth);
    height = Math.max(1, wrap.clientHeight);
    for (const canvas of [fxCanvas, trailCanvas]) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trail.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = canvasLayout(width, height);
    anchorAll();
    aurora.resize();
  };

  const drawRiver = () => {
    const midY = (layout.riverTop + layout.riverBottom) / 2;
    const riverHeight = layout.riverBottom - layout.riverTop;
    const flow = fx.createLinearGradient(0, layout.riverTop, 0, layout.riverBottom);
    flow.addColorStop(0, 'rgba(0,212,255,0.015)'); flow.addColorStop(0.5, 'rgba(0,212,255,0.06)'); flow.addColorStop(1, 'rgba(0,212,255,0.015)');
    fx.fillStyle = flow; fx.fillRect(layout.padX, layout.riverTop, width - layout.padX * 2, riverHeight);
    const ribbon = fx.createLinearGradient(layout.padX, 0, width - layout.padX, 0);
    STAGES.forEach((stage, index) => ribbon.addColorStop(index / (STAGES.length - 1), STAGE_COLORS[stage]));
    for (const pass of [{ width: 6, alpha: 0.07 }, { width: 1.8, alpha: 0.34 }]) {
      fx.strokeStyle = ribbon; fx.globalAlpha = pass.alpha; fx.lineWidth = pass.width; fx.beginPath();
      for (let x = layout.padX; x <= width - layout.padX; x += 7) {
        const y = midY + (Math.sin(x * 0.011 + simT * 1.9) * 0.5 + Math.sin(x * 0.023 - simT * 1.15) * 0.3
          + Math.sin(x * 0.005 + simT * 0.55) * 0.42) * (14 + 70 * props.hookStream.energy);
        if (x === layout.padX) fx.moveTo(x, y); else fx.lineTo(x, y);
      }
      fx.stroke();
    }
    fx.globalAlpha = 1;
    for (let layer = 0; layer < 3; layer++) {
      const amplitude = (10 + layer * 9) * (0.7 + props.hookStream.energy * 1.1);
      const speed = simT * (0.7 + layer * 0.45) * (1 + props.hookStream.energy);
      fx.beginPath();
      for (let x = layout.padX; x <= width - layout.padX; x += 6) {
        const y = midY + Math.sin(x * 0.012 + speed + layer * 1.7) * amplitude + Math.sin(x * 0.031 - speed * 1.4) * amplitude * 0.35;
        if (x === layout.padX) fx.moveTo(x, y); else fx.lineTo(x, y);
      }
      fx.strokeStyle = `rgba(0,212,255,${0.05 + layer * 0.035 + props.hookStream.energy * 0.05})`; fx.lineWidth = 1.5 - layer * 0.3; fx.stroke();
    }
    fx.save(); fx.globalAlpha = 0.1 + props.hookStream.energy * 0.08; fx.strokeStyle = '#00d4ff'; fx.lineWidth = 1.5;
    const offset = (simT * 60) % 90;
    for (let x = layout.padX - 90 + offset; x < width - layout.padX; x += 90) {
      fx.beginPath(); fx.moveTo(x, midY - 7); fx.lineTo(x + 9, midY); fx.lineTo(x, midY + 7); fx.stroke();
    }
    fx.restore();
    for (let index = 1; index < STAGES.length; index++) {
      const x = layout.padX + index * layout.colW;
      const separator = fx.createLinearGradient(0, layout.riverTop - 30, 0, layout.riverBottom + 6);
      separator.addColorStop(0, 'rgba(0,212,255,0)'); separator.addColorStop(0.5, 'rgba(0,212,255,0.14)'); separator.addColorStop(1, 'rgba(0,212,255,0)');
      fx.fillStyle = separator; fx.fillRect(x - 0.5, layout.riverTop - 30, 1, layout.riverBottom - layout.riverTop + 36);
      fx.strokeStyle = 'rgba(0,212,255,.25)'; fx.beginPath(); fx.moveTo(x - 5, midY - 9); fx.lineTo(x + 3, midY); fx.lineTo(x - 5, midY + 9); fx.stroke();
    }
  };

  const drawZones = () => {
    fx.fillStyle = 'rgba(255,184,0,0.04)'; fx.fillRect(layout.padX, layout.shelfY - layout.shelfH / 2, width - layout.padX * 2, layout.shelfH);
    fx.strokeStyle = 'rgba(255,184,0,0.16)'; fx.setLineDash([4, 6]); fx.beginPath(); fx.moveTo(layout.padX, layout.shelfY - layout.shelfH / 2); fx.lineTo(width - layout.padX, layout.shelfY - layout.shelfH / 2); fx.stroke(); fx.setLineDash([]);
    fx.font = '600 9px "JetBrains Mono"'; fx.fillStyle = 'rgba(255,184,0,0.5)'; fx.textAlign = 'right'; fx.fillText('⏸ SHELF — parked / yielded by governor', width - layout.padX - 8, layout.shelfY - layout.shelfH / 2 + 11);
    const frost = fx.createLinearGradient(0, layout.doldrumsY - layout.doldrumsH / 2, 0, layout.doldrumsY + layout.doldrumsH / 2);
    frost.addColorStop(0, 'rgba(120,170,255,0.02)'); frost.addColorStop(1, 'rgba(120,170,255,0.08)'); fx.fillStyle = frost;
    fx.fillRect(layout.padX, layout.doldrumsY - layout.doldrumsH / 2, width - layout.padX * 2, layout.doldrumsH);
    fx.strokeStyle = 'rgba(159,199,255,0.2)'; fx.beginPath(); fx.moveTo(layout.padX, layout.doldrumsY - layout.doldrumsH / 2); fx.lineTo(width - layout.padX, layout.doldrumsY - layout.doldrumsH / 2); fx.stroke();
    const staleShown = list().filter((orb) => orb.state === 'stale').length;
    const census = props.parkedTotal != null
      ? `${props.parkedTotal} parked · showing ${staleShown}`
      : `${staleShown} frozen`;
    fx.fillStyle = 'rgba(159,199,255,0.55)'; fx.fillText(`❄ DOLDRUMS — stalled, nothing autonomous will advance · ${census}`, width - layout.padX - 8, layout.doldrumsY - layout.doldrumsH / 2 + 11); fx.textAlign = 'left';
    if (Math.random() < 0.12) frostMotes(layout.padX + Math.random() * (width - layout.padX * 2), layout.doldrumsY - 20, 1);
  };

  const drawPortal = () => {
    const top = layout.riverTop - 20; const bottom = layout.riverBottom + 6; const pulse = 0.5 + 0.5 * Math.sin(simT * 2.4);
    const glow = fx.createLinearGradient(layout.portalX - 26, 0, layout.portalX + 4, 0); glow.addColorStop(0, 'rgba(232,237,248,0)'); glow.addColorStop(1, `rgba(232,237,248,${0.28 + pulse * 0.3})`);
    fx.fillStyle = glow; fx.fillRect(layout.portalX - 26, top, 30, bottom - top); fx.fillStyle = `rgba(255,255,255,${0.5 + pulse * 0.4})`; fx.fillRect(layout.portalX - 1, top, 2, bottom - top);
    fx.save(); fx.translate(layout.portalX + 11, (top + bottom) / 2); fx.rotate(Math.PI / 2); fx.font = '600 9px "JetBrains Mono"'; fx.textAlign = 'center'; fx.fillStyle = 'rgba(232,237,248,.55)'; fx.fillText('M A I N', 0, 0); fx.restore();
  };

  const drawSun = () => {
    const pulse = 0.5 + 0.5 * Math.sin(simT * 1.8); const radius = 16 + pulse * 3;
    const glow = fx.createRadialGradient(layout.sunX, layout.sunY, 0, layout.sunX, layout.sunY, radius * 3.2); glow.addColorStop(0, 'rgba(157,78,221,.75)'); glow.addColorStop(0.35, 'rgba(157,78,221,.22)'); glow.addColorStop(1, 'rgba(157,78,221,0)');
    fx.fillStyle = glow; fx.beginPath(); fx.arc(layout.sunX, layout.sunY, radius * 3.2, 0, 7); fx.fill(); fx.fillStyle = '#cfa8ff'; fx.shadowColor = '#9d4edd'; fx.shadowBlur = 16; fx.beginPath(); fx.arc(layout.sunX, layout.sunY, radius * 0.55, 0, 7); fx.fill(); fx.shadowBlur = 0;
    fx.save(); fx.translate(layout.sunX, layout.sunY); fx.rotate(simT * 0.5); fx.strokeStyle = 'rgba(157,78,221,.6)'; fx.setLineDash([3, 7]); fx.lineWidth = 1.4; fx.beginPath(); fx.arc(0, 0, radius + 7, 0, 7); fx.stroke(); fx.rotate(-simT * 0.9); fx.strokeStyle = 'rgba(157,78,221,.3)'; fx.setLineDash([2, 9]); fx.beginPath(); fx.arc(0, 0, radius + 14, 0, 7); fx.stroke(); fx.setLineDash([]); fx.restore();
    fx.font = '600 9px "JetBrains Mono"'; fx.fillStyle = 'rgba(207,168,255,.85)'; fx.textAlign = 'center'; fx.fillText('FLYWHEEL', layout.sunX, layout.sunY + radius + 20); fx.textAlign = 'left';
  };

  const drawStageHeaders = () => {
    fx.textAlign = 'center';
    for (let index = 0; index < STAGES.length; index++) {
      const stage = STAGES[index]; const x = layout.padX + (index + 0.5) * layout.colW;
      const inLane = list().filter((orb) => orb.stage === stage && orb.state === 'active');
      const pulse = Math.min(1, inLane.reduce((sum, orb) => sum + orb.heat, 0) / 3); const color = STAGE_COLORS[stage];
      fx.font = '700 12px "Space Grotesk"'; fx.fillStyle = hexA(color, 0.5 + pulse * 0.45); fx.shadowColor = color; fx.shadowBlur = 8; fx.fillText(stage, x, layout.riverTop - 44); fx.shadowBlur = 0;
      fx.font = '10px "JetBrains Mono"'; fx.fillStyle = 'rgba(122,138,170,.8)'; fx.fillText(stage === 'MERGE' ? `queue ${props.mergeQueue ?? inLane.length}` : inLane.length ? `${inLane.length} ●` : '·', x, layout.riverTop - 30);
      fx.fillStyle = hexA(color, 0.25 + (inLane.length ? 0.25 : 0)); fx.fillRect(x - 26, layout.riverTop - 25, 52, 2);
    }
    fx.textAlign = 'left';
  };

  const drawGateFlashes = () => {
    const midY = (layout.riverTop + layout.riverBottom) / 2;
    for (const gate of gateFlashes) { const radius = 8 + gate.t * 75; const alpha = Math.max(0, 1 - gate.t * 1.4); fx.strokeStyle = `rgba(0,212,255,${alpha * 0.8})`; fx.lineWidth = 2; fx.beginPath(); fx.arc(gate.x, midY, radius, 0, 7); fx.stroke(); }
  };

  const drawConvoys = () => {
    for (const orb of list()) {
      if (!orb.convoy || orb.state !== 'active') continue;
      const baseRadius = 30 + orb.convoy.length * 3; fx.strokeStyle = 'rgba(255,184,0,.16)'; fx.setLineDash([2, 5]); fx.lineWidth = 1; fx.beginPath(); fx.arc(orb.x, orb.y, baseRadius, 0, 7); fx.stroke(); fx.setLineDash([]);
      for (const satellite of orb.convoy) {
        const orbitRadius = satellite.orbitR || baseRadius; satellite.sx = orb.x + Math.cos(satellite.angle) * orbitRadius; satellite.sy = orb.y + Math.sin(satellite.angle) * orbitRadius;
        fx.strokeStyle = `rgba(255,184,0,${0.14 + satellite.flash * 0.5})`; fx.lineWidth = 1 + satellite.flash * 1.5; fx.beginPath(); fx.moveTo(orb.x, orb.y); fx.lineTo(satellite.sx, satellite.sy); fx.stroke();
      }
    }
  };

  const drawFrostCrown = (orb: RenderOrb, radius: number, frost: number) => {
    fx.strokeStyle = `rgba(191,227,255,${frost * 0.85})`; fx.lineWidth = 1;
    for (let index = 0; index < 6; index++) { const angle = index * Math.PI / 3 + simT * 0.15; fx.beginPath(); fx.moveTo(orb.x + Math.cos(angle) * (radius + 2), orb.y + Math.sin(angle) * (radius + 2)); fx.lineTo(orb.x + Math.cos(angle) * (radius + 4 + 7 * frost), orb.y + Math.sin(angle) * (radius + 4 + 7 * frost)); fx.stroke(); }
  };
  const drawLabel = (orb: RenderOrb, text: string, color: string) => {
    fx.font = '600 10px "JetBrains Mono"'; fx.textAlign = 'center'; fx.shadowColor = 'rgba(0,0,0,.9)'; fx.shadowBlur = 4; fx.fillStyle = color; fx.fillText(text, orb.x, orb.y - orb.radius - 8); fx.shadowBlur = 0; fx.textAlign = 'left';
  };

  const drawOrbs = () => {
    const now = Date.now();
    for (const orb of list()) {
      fx.globalAlpha = orb.fading ?? 1;
      const baseRole = roleColor(orb.role); const color = orb.frost > 0.02 ? mixColor(baseRole, ICE, orb.frost * 0.8) : baseRole;
      const compact = orb.compactT > 0 ? 1 - orb.compactT * 0.35 : 1; const radius = orb.radius * (0.85 + orb.heat * 0.45) * (orb.merging ? 1.2 : 1) * compact;
      if (orb.state === 'stale') {
        // Orbit-tinted frost (PAN-3490): a parked orb's ring, glow, and label
        // carry its orbit's color so the Doldrums reads WHY things are parked.
        const tint = parkedOrbitColor(orb.parkedOrbit);
        const glow = fx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, radius * 1.6); glow.addColorStop(0, hexA(tint, 0.4)); glow.addColorStop(1, hexA(tint, 0)); fx.fillStyle = glow; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 1.6, 0, 7); fx.fill();
        fx.fillStyle = 'rgba(70,90,130,.9)'; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.7, 0, 7); fx.fill(); fx.strokeStyle = hexA(tint, 0.75); fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.85, 0, 7); fx.stroke(); drawFrostCrown(orb, radius * 0.9, 1);
        const orbitTag = parkedOrbitTag(orb.parkedOrbit);
        drawLabel(orb, orbitTag ? `❄ ${orb.id} · ${orbitTag} ${fmtAge(orb.staleMin)}` : `❄ ${orb.id} · ${fmtAge(orb.staleMin)} idle`, hexA(tint, 0.85));
        fx.globalAlpha = 1; continue;
      }
      if (orb.state === 'failed') {
        const blink = 0.5 + 0.5 * Math.sin(simT * 3 + orb.wobA); fx.fillStyle = 'rgba(96,22,48,.95)'; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.62, 0, 7); fx.fill(); fx.strokeStyle = `rgba(255,45,124,${0.35 + blink * 0.55})`; fx.lineWidth = 1.6; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.95, 0, 7); fx.stroke(); drawLabel(orb, `✗ ${orb.id} · merge failed`, 'rgba(255,120,165,.9)'); fx.globalAlpha = 1; continue;
      }
      if (orb.state === 'shelf') {
        fx.fillStyle = 'rgba(255,184,0,.18)'; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 1.5, 0, 7); fx.fill(); fx.fillStyle = 'rgba(140,110,40,.9)'; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.62, 0, 7); fx.fill(); fx.strokeStyle = 'rgba(255,184,0,.55)'; fx.setLineDash([3, 3]); fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.95, 0, 7); fx.stroke(); fx.setLineDash([]); fx.fillStyle = 'rgba(10,14,26,.9)'; fx.font = '700 8px "JetBrains Mono"'; fx.textAlign = 'center'; fx.fillText('⏸', orb.x, orb.y + 2); drawLabel(orb, `⏸ ${orb.id}`, 'rgba(255,184,0,.75)'); if (orb.yieldReason) { const reason = orb.yieldReason.length > 58 ? `${orb.yieldReason.slice(0, 57)}…` : orb.yieldReason; fx.font = '500 8.5px "JetBrains Mono"'; fx.fillStyle = 'rgba(255,184,0,.5)'; fx.fillText(reason, orb.x, orb.y - orb.radius - 21); } fx.textAlign = 'left'; fx.globalAlpha = 1; continue;
      }
      const glow = fx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, radius * 3); glow.addColorStop(0, hexA(baseRole, 0.45 * (0.3 + orb.heat) * (1 - orb.frost * 0.6))); glow.addColorStop(1, hexA(baseRole, 0)); fx.fillStyle = glow; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 3, 0, 7); fx.fill();
      fx.fillStyle = color; fx.shadowColor = baseRole; fx.shadowBlur = (14 + orb.heat * 22) * (1 - orb.frost * 0.7); fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.6, 0, 7); fx.fill(); fx.shadowBlur = 0; fx.fillStyle = `rgba(255,255,255,${0.35 + orb.heat * 0.5})`; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.28, 0, 7); fx.fill();
      if (orb.glyph) { fx.fillStyle = 'rgba(10,14,26,.92)'; fx.font = '700 8px "JetBrains Mono"'; fx.textAlign = 'center'; fx.fillText(orb.glyph, orb.x, orb.y + 2.5); }
      fx.strokeStyle = hexA(projectColor(orb.project), 0.8); fx.lineWidth = 1.6; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.92, 0, 7); fx.stroke(); if (orb.frost > 0.25) drawFrostCrown(orb, radius, orb.frost);
      if (orb.waitUntil > now) { fx.save(); fx.translate(orb.x, orb.y); fx.rotate(simT * 1.8); fx.strokeStyle = 'rgba(255,184,0,.9)'; fx.setLineDash([5, 4]); fx.lineWidth = 1.8; fx.beginPath(); fx.arc(0, 0, radius * 1.18, 0, 7); fx.stroke(); fx.restore(); fx.setLineDash([]); }
      if (orb.thinkUntil > now) { fx.strokeStyle = 'rgba(255,255,255,.75)'; fx.lineWidth = 1.6; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 0.55, simT * 4, simT * 4 + 2.2); fx.stroke(); }
      if (orb.compactT > 0) { fx.strokeStyle = 'rgba(255,119,0,.9)'; fx.lineWidth = 2; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 1.15, 0, 7); fx.stroke(); }
      if (orb.broken) { const flicker = 0.5 + 0.5 * Math.sin(simT * 9); fx.strokeStyle = `rgba(255,68,68,${0.4 + flicker * 0.5})`; fx.lineWidth = 2.2; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 1.3, 0, 7); fx.stroke(); if (Math.random() < 0.05) burst(orb.x, orb.y, '#ff4444', 3, 40, 0.8, 1.6); }
      if (orb.convoy) for (const satellite of orb.convoy) { const satelliteRadius = 4.6 + satellite.flash * 2.5; fx.fillStyle = satellite.flash > 0 ? '#ffe9b8' : '#ffb800'; fx.shadowColor = '#ffb800'; fx.shadowBlur = 6 + satellite.flash * 18; fx.beginPath(); fx.arc(satellite.sx, satellite.sy, satelliteRadius, 0, 7); fx.fill(); fx.shadowBlur = 0; fx.fillStyle = 'rgba(10,14,26,.9)'; fx.font = '700 6px "JetBrains Mono"'; fx.textAlign = 'center'; fx.fillText(SAT_LETTERS[satellite.role] ?? satellite.role[0]?.toUpperCase() ?? '?', satellite.sx, satellite.sy + 2.2); if (satellite.arriving) { fx.fillStyle = 'rgba(255,184,0,.7)'; fx.font = '400 6.5px "JetBrains Mono"'; fx.fillText(`${satellite.role.toUpperCase()} · arriving`, satellite.sx, satellite.sy + 14); } }
      if (orb.warn && !orb.broken) { fx.strokeStyle = 'rgba(255,184,0,.72)'; fx.setLineDash([4, 3]); fx.lineWidth = 1.4; fx.beginPath(); fx.arc(orb.x, orb.y, radius * 1.28, 0, 7); fx.stroke(); fx.setLineDash([]); }
      if (orb.id === props.selectedId) { fx.save(); fx.translate(orb.x, orb.y); fx.rotate(simT * 1.4); fx.strokeStyle = 'rgba(255,255,255,.85)'; fx.setLineDash([6, 5]); fx.beginPath(); fx.arc(0, 0, radius + 9, 0, 7); fx.stroke(); fx.restore(); fx.setLineDash([]); }
      if (orb.flashT > simT) { const flash = clamp((orb.flashT - simT) / 0.8, 0, 1); fx.strokeStyle = `rgba(255,255,255,${flash * 0.9})`; fx.beginPath(); fx.arc(orb.x, orb.y, radius + 5 + (1 - flash) * 12, 0, 7); fx.stroke(); }
      drawLabel(orb, orb.broken || orb.warn ? `${orb.id} ⚠` : orb.id, orb.broken ? 'rgba(255,120,120,.95)' : orb.warn ? 'rgba(255,184,0,.95)' : orb.frost > 0.5 ? 'rgba(191,227,255,.9)' : 'rgba(232,237,248,.92)');
      fx.font = '400 7px "JetBrains Mono"'; fx.textAlign = 'center'; const tag = orb.broken ? '⚠ stack broken' : orb.frost > 0.5 ? `stale ${fmtAge(orb.idleMin)}` : orb.waitUntil > now ? 'waiting…' : orb.thinkUntil > now ? 'thinking…' : `${orb.role} · ~${Math.round(orb.heat * 34)} ev/m`; fx.fillStyle = orb.broken ? 'rgba(255,68,68,.85)' : 'rgba(122,138,170,.6)'; fx.fillText(tag, orb.x, orb.y + radius + 16); fx.textAlign = 'left'; fx.globalAlpha = 1;
    }
  };

  const drawParticles = () => {
    fx.globalCompositeOperation = 'lighter';
    for (const particle of particles) { const remaining = 1 - particle.life / particle.maxLife; fx.globalAlpha = remaining * (particle.kind === 'frost' || particle.kind === 'snow' ? 0.5 : 0.85); fx.fillStyle = particle.color; if (particle.kind === 'dollar') { fx.font = `700 ${particle.size}px "JetBrains Mono"`; fx.textAlign = 'center'; fx.fillText('$', particle.x, particle.y); } else { fx.beginPath(); fx.arc(particle.x, particle.y, particle.size * (particle.kind === 'frost' || particle.kind === 'snow' ? 1 : remaining + 0.3), 0, 7); fx.fill(); } }
    fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over'; fx.textAlign = 'left';
  };
  const drawPulses = () => { for (const pulse of pulses) { fx.globalAlpha = Math.max(0, pulse.alpha); fx.strokeStyle = pulse.color; fx.lineWidth = pulse.width; fx.beginPath(); fx.arc(pulse.x, pulse.y, pulse.r, 0, 7); fx.stroke(); } fx.globalAlpha = 1; };
  const drawTickers = () => { fx.font = '500 10px "JetBrains Mono"'; for (const item of tickers) { const alpha = item.life < 1 ? item.life : Math.max(0, 1 - (item.life - (item.maxLife - 2)) / 2); fx.globalAlpha = alpha * 0.55; fx.fillStyle = item.color; fx.fillText(item.text, item.x, item.y); } fx.globalAlpha = 1; };
  const drawTide = () => { if (!tide.active) return; const glow = fx.createLinearGradient(tide.x - 60, 0, tide.x + 6, 0); glow.addColorStop(0, 'rgba(255,184,0,0)'); glow.addColorStop(0.85, 'rgba(255,184,0,.22)'); glow.addColorStop(1, 'rgba(255,184,0,.55)'); fx.fillStyle = glow; fx.fillRect(tide.x - 60, layout.riverTop - 30, 66, layout.riverBottom - layout.riverTop + layout.shelfH + 40); fx.font = '600 9px "JetBrains Mono"'; fx.fillStyle = 'rgba(255,184,0,.9)'; fx.fillText('GOVERNOR', tide.x - 52, layout.riverTop - 36); };
  const drawSweepBeam = () => {
    if (!sweepBeam.active) return;
    const top = layout.doldrumsY - layout.doldrumsH / 2 - 8;
    const height = layout.doldrumsH + 26;
    const glow = fx.createLinearGradient(sweepBeam.x - 52, 0, sweepBeam.x + 8, 0);
    glow.addColorStop(0, hexA(SWEEP_BEAM_COLOR, 0));
    glow.addColorStop(0.8, hexA(SWEEP_BEAM_COLOR, 0.2));
    glow.addColorStop(1, hexA(SWEEP_BEAM_COLOR, 0.5));
    fx.fillStyle = glow;
    fx.fillRect(sweepBeam.x - 52, top, 60, height);
    fx.fillStyle = hexA(SWEEP_BEAM_COLOR, 0.85);
    fx.fillRect(sweepBeam.x + 7, top, 1.5, height);
    fx.font = '600 8.5px "JetBrains Mono"';
    fx.fillStyle = hexA(SWEEP_BEAM_COLOR, 0.9);
    fx.fillText('🧹 SWEEP', sweepBeam.x - 48, top - 4);
  };
  const drawFlares = () => {
    for (const flare of flares) {
      const fade = clamp(1 - flare.t / FLARE_LIFETIME, 0, 1);
      const pulse = 0.55 + 0.45 * Math.sin(simT * 7);
      const glow = fx.createRadialGradient(flare.x, flare.y, 0, flare.x, flare.y, 14 + pulse * 6);
      glow.addColorStop(0, hexA(SWEEP_FLARE_COLOR, 0.75 * fade * pulse));
      glow.addColorStop(1, hexA(SWEEP_FLARE_COLOR, 0));
      fx.fillStyle = glow;
      fx.beginPath();
      fx.arc(flare.x, flare.y, 14 + pulse * 6, 0, 7);
      fx.fill();
      fx.fillStyle = hexA('#fff3c8', fade);
      fx.beginPath();
      fx.arc(flare.x, flare.y, 2.2, 0, 7);
      fx.fill();
      fx.strokeStyle = hexA(SWEEP_FLARE_COLOR, 0.5 * fade);
      fx.lineWidth = 1;
      fx.beginPath();
      fx.moveTo(flare.x, flare.y + 4);
      fx.lineTo(flare.x, flare.y + 16);
      fx.stroke();
      if (flare.t < FLARE_LIFETIME * 0.6) {
        fx.font = '600 8px "JetBrains Mono"';
        fx.fillStyle = hexA(SWEEP_FLARE_COLOR, fade * 0.85);
        fx.fillText('⚑', flare.x + 8, flare.y + 2);
      }
    }
  };
  const drawConstellation = () => { const count = props.conversations ?? 0; if (!count) return; const start = (width - (count * 14 + 150)) / 2; fx.font = '600 9px "JetBrains Mono"'; fx.fillStyle = 'rgba(0,212,255,.5)'; fx.fillText(`◈ ${count} CONVERSATIONS`, start, 33); for (let index = 0; index < count; index++) { const x = start + 130 + index * 14 + Math.sin(index * 3.7) * 3; const y = 30 + Math.sin(simT * 1.3 + index * 1.7) * 4; const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(simT * 2 + index)); fx.fillStyle = `rgba(0,212,255,${0.2 + twinkle * 0.55})`; fx.beginPath(); fx.arc(x, y, 2 + twinkle * 1.2, 0, 7); fx.fill(); } };
  const drawSequencer = () => { if (props.sequencer === false) return; const x = layout.sunX + 118; const y = layout.sunY - 2; const pulse = 0.5 + 0.5 * Math.sin(simT * 1.1 + 2); fx.save(); fx.translate(x, y); fx.rotate(simT * 0.7); fx.strokeStyle = `rgba(255,119,0,${0.3 + pulse * 0.3})`; fx.setLineDash([2, 4]); fx.beginPath(); fx.arc(0, 0, 10 + pulse * 2, 0, 7); fx.stroke(); fx.rotate(-simT * 1.3); fx.strokeStyle = `rgba(255,119,0,${0.16 + pulse * 0.18})`; fx.setLineDash([2, 7]); fx.beginPath(); fx.arc(0, 0, 16 + pulse * 2, 0, 7); fx.stroke(); fx.restore(); fx.setLineDash([]); fx.fillStyle = 'rgba(255,150,60,.9)'; fx.beginPath(); fx.arc(x, y, 5, 0, 7); fx.fill(); fx.font = '600 8.5px "JetBrains Mono"'; fx.fillStyle = 'rgba(255,150,60,.7)'; fx.fillText('SEQUENCER', x - 28, y + 28); };

  const advance = (dt: number) => {
    for (const orb of list()) {
      orb.heat = Math.max(orb.state === 'stale' ? 0.04 : 0.12, orb.heat * Math.pow(0.5, dt / 9));
      orb.wobA += dt * orb.wobSpeed * (1 + orb.heat * 2.2); orb.wobB += dt * orb.wobSpeed * 0.7; orb.compactT = Math.max(0, orb.compactT - dt);
      if (orb.fading !== null) { orb.fading -= dt; if (orb.fading <= 0) { renderOrbs.delete(orb.id); continue; } }
      if (orb.merging) { orb.mergeVx += dt * 260; orb.x += orb.mergeVx * dt; burst(orb.x, orb.y, '#e8edf8', 3, 40, 0.7, 2); if (orb.x > layout.portalX - 6) finishMerge(orb); continue; }
      if (orb.state === 'active' && orb.stage === 'MERGE') {
        const dwell = advanceMergeDwell(orb.stage, orb.mergeStatus, orb.mergeDwell, dt);
        orb.mergeDwell = dwell.remaining;
        if (dwell.shouldStart) startMerge(orb);
      }
      if (orb.state === 'shelf') { orb.y += (layout.shelfY - orb.y) * dt * 3; orb.x += (orb.tx - orb.x) * dt * 1.5; continue; }
      if (orb.state === 'failed') { orb.y += Math.sin(simT * 0.5 + orb.wobA) * dt * 3; orb.x += Math.cos(simT * 0.4 + orb.wobB) * dt * 2; if (Math.random() < dt * 0.8) burst(orb.x, orb.y, '#ff2d7c', 1, 22, 1.2, 1.4); continue; }
      if (orb.state === 'stale') { orb.staleMin += dt * 2; orb.x += (orb.tx + Math.sin(simT * 0.3 + orb.wobA) * 8 - orb.x) * dt * 1.2; orb.y += (orb.ty + Math.cos(simT * 0.22 + orb.wobB) * 4 - orb.y) * dt * 1.2; if (Math.random() < dt * 0.5) frostMotes(orb.x, orb.y, 1); continue; }
      const frost = advanceFrostAccrual(orb.idleMin, orb.frostHold, dt); orb.idleMin = frost.idleMinutes; orb.frost = frost.frost; orb.frostHold = frost.frostHoldSeconds; if (orb.frost > 0.55 && Math.random() < dt * 5) snow(orb.x, orb.y); if (frost.sinkToDoldrums) { orb.state = 'stale'; orb.staleMin = Math.max(31, Math.round(orb.idleMin)); anchorAll(); ticker(`${orb.id} ❄ frozen`, ICE); continue; }
      const orbitRadius = orb.heat * 26; orb.orbitA += dt * (1 + orb.heat * 4); const targetX = orb.tx + Math.cos(orb.orbitA) * orbitRadius + Math.sin(orb.wobA) * 10; const targetY = orb.ty + Math.sin(orb.orbitA) * orbitRadius * 0.7 + Math.cos(orb.wobB) * 8; orb.x += (targetX - orb.x) * dt * 3.2; orb.y += (targetY - orb.y) * dt * 3.2;
      for (const neighbor of list()) { if (neighbor === orb || neighbor.state !== 'active' || neighbor.stage !== orb.stage || neighbor.merging) continue; const dx = orb.x - neighbor.x; const dy = orb.y - neighbor.y; const distanceSquared = dx * dx + dy * dy; if (distanceSquared > 1 && distanceSquared < 74 * 74) { const distance = Math.sqrt(distanceSquared); const push = (74 - distance) / 74 * 26 * dt; orb.x += dx / distance * push; orb.y += dy / distance * push; } }
      if (orb.convoy) for (const satellite of orb.convoy) { satellite.angle += dt * (0.6 + satellite.heat); satellite.flash = Math.max(0, satellite.flash - dt * 2); const baseRadius = 30 + orb.convoy.length * 3; if (satellite.arriving) { satellite.orbitR = Math.max(baseRadius, satellite.orbitR - dt * 36); if (satellite.orbitR <= baseRadius) { satellite.arriving = false; ring(orb.x, orb.y, '#ffb800', 60, 2); } } else satellite.orbitR = baseRadius; }
    }
    for (let index = particles.length - 1; index >= 0; index--) { const particle = particles[index]!; particle.life += dt; if (particle.life > particle.maxLife) { particles.splice(index, 1); continue; } particle.x += particle.vx * dt; particle.y += particle.vy * dt; if (particle.kind === 'spark') { particle.vy -= 14 * dt; particle.vx *= 1 - dt * 1.4; } else if (particle.kind === 'frost') particle.vx += Math.sin(simT * 2 + particle.y) * dt * 4; else if (particle.kind === 'snow') particle.vx += Math.sin(particle.life * 6) * dt * 8; else particle.vy *= 1 - dt * 0.5; }
    for (let index = pulses.length - 1; index >= 0; index--) { const pulse = pulses[index]!; pulse.r += dt * (pulse.maxR - 6) * 1.6; pulse.alpha -= dt * 1.1; if (pulse.alpha <= 0 || pulse.r >= pulse.maxR) pulses.splice(index, 1); }
    for (let index = tickers.length - 1; index >= 0; index--) { const item = tickers[index]!; item.life += dt; item.x += dt * 34; if (item.life > item.maxLife) tickers.splice(index, 1); }
    for (let index = gateFlashes.length - 1; index >= 0; index--) { gateFlashes[index]!.t += dt; if (gateFlashes[index]!.t > 0.8) gateFlashes.splice(index, 1); }
    if (tide.active) { tide.t += dt; tide.x = layout.padX - 40 + tide.t / 1.6 * (width - layout.padX * 2 + 80); for (const orb of list()) { if (Math.abs(orb.x - tide.x) >= 30) continue; if (orb.id === tide.targetId && orb.state === 'active') { orb.state = 'shelf'; orb.yieldReason ||= 'yield: freeing a slot'; burst(orb.x, orb.y, '#ffb800', 20, 70, 1.2, 2.2); ring(orb.x, orb.y, '#ffb800', 60, 2); } if (orb.id === tide.beneficiaryId && orb.state === 'shelf') thaw(orb); } if (tide.x > width - layout.padX + 40) tide.active = false; }
    // Sweeper beam: crosses the Doldrums in ~1.8s; every frozen orb the light
    // touches glints — the scan visibly TOUCHES each parked issue it scanned.
    if (sweepBeam.active) {
      sweepBeam.t += dt;
      sweepBeam.x = layout.padX - 30 + (sweepBeam.t / 1.8) * (width - layout.padX * 2 + 60);
      for (const orb of list()) {
        if (orb.state !== 'stale') continue;
        if (Math.abs(orb.x - sweepBeam.x) < 26) orb.flashT = Math.max(orb.flashT, simT + 0.45);
      }
      if (Math.random() < dt * 30 && particles.length < PARTICLE_LIMIT) {
        particles.push({ x: sweepBeam.x + (Math.random() - 0.5) * 10, y: layout.doldrumsY + (Math.random() - 0.5) * layout.doldrumsH, vx: -14 - Math.random() * 10, vy: (Math.random() - 0.5) * 6, life: 0, maxLife: 0.7 + Math.random() * 0.5, color: SWEEP_BEAM_COLOR, size: 1 + Math.random(), kind: 'spark' });
      }
      if (sweepBeam.x > width - layout.padX + 40) sweepBeam.active = false;
    }
    // Signal flares rise, pulse, and burn out.
    for (let index = flares.length - 1; index >= 0; index--) {
      const flare = flares[index]!;
      flare.t += dt;
      flare.y -= dt * 22;
      flare.x += Math.sin(flare.t * 2.2) * dt * 6;
      if (flare.t > FLARE_LIFETIME) flares.splice(index, 1);
    }
  };

  const draw = () => {
    fx.clearRect(0, 0, width, height);
    trail.globalCompositeOperation = 'destination-out'; trail.fillStyle = 'rgba(0,0,0,0.055)'; trail.fillRect(0, 0, width, height); trail.globalCompositeOperation = 'lighter';
    for (const orb of list()) { if (orb.state === 'stale' || orb.state === 'shelf') continue; const color = roleColor(orb.role); const glow = trail.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, 5 + orb.heat * 8); glow.addColorStop(0, hexA(color, 0.5 * (0.25 + orb.heat))); glow.addColorStop(1, hexA(color, 0)); trail.fillStyle = glow; trail.beginPath(); trail.arc(orb.x, orb.y, 5 + orb.heat * 8, 0, 7); trail.fill(); }
    drawRiver(); drawZones(); drawPortal(); drawSun();
    fx.globalCompositeOperation = 'lighter'; fx.drawImage(trailCanvas, 0, 0, width, height); fx.globalCompositeOperation = 'source-over';
    drawGateFlashes(); drawConvoys(); drawOrbs(); drawParticles(); drawPulses(); drawTickers(); drawTide(); drawSweepBeam(); drawFlares(); drawStageHeaders(); drawConstellation(); drawSequencer();
  };

  const updateHover = () => {
    const next = resolveHoverOrb(
      list(),
      hoverOrb,
      pointer.x,
      pointer.y,
      pointer.inside,
    );
    if (next === hoverOrb) return;
    hoverOrb = next;
    props.onHover?.(next, next ? { x: next.x, y: next.y, canvasWidth: width } : null);
  };

  const frame = (now: number) => {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; simT += dt;
    advance(dt); updateHover(); draw(); frameId = window.requestAnimationFrame(frame);
  };

  resize(); reconcile(initial); frameId = window.requestAnimationFrame(frame);
  return {
    api,
    update: reconcile,
    resize,
    pick(x, y) { return pickOrb(list(), x, y); },
    setPointer(x, y, inside) { pointer.x = x; pointer.y = y; pointer.inside = inside; if (!inside && hoverOrb) { hoverOrb = null; props.onHover?.(null, null); } },
    dispose() { disposed = true; window.cancelAnimationFrame(frameId); aurora.dispose(); renderOrbs.clear(); particles.length = 0; pulses.length = 0; tickers.length = 0; },
  };
}

export const RiverCanvas = forwardRef<RiverCanvasHandle, RiverCanvasProps>(function RiverCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useImperativeHandle(ref, () => ({
    emitSparks: (...args) => engineRef.current?.api.emitSparks(...args),
    emitRing: (...args) => engineRef.current?.api.emitRing(...args),
    emitTicker: (...args) => engineRef.current?.api.emitTicker(...args),
    playTide: (...args) => engineRef.current?.api.playTide(...args),
    playMerge: (...args) => engineRef.current?.api.playMerge(...args),
    playThaw: (...args) => engineRef.current?.api.playThaw(...args),
    playSweep: () => engineRef.current?.api.playSweep(),
    playFlare: (...args) => engineRef.current?.api.playFlare(...args),
    pulseSun: () => engineRef.current?.api.pulseSun(),
    spawnFromSun: (...args) => engineRef.current?.api.spawnFromSun(...args),
    gateFlash: (...args) => engineRef.current?.api.gateFlash(...args),
    resize: () => engineRef.current?.resize(),
  }), []);

  useEffect(() => {
    const wrap = wrapRef.current; const gl = glRef.current; const fx = fxRef.current;
    if (!wrap || !gl || !fx) return;
    const engine = createEngine(wrap, gl, fx, props); engineRef.current = engine;
    const observer = new ResizeObserver(() => engine?.resize()); observer.observe(wrap);
    return () => { observer.disconnect(); engine?.dispose(); engineRef.current = null; };
  }, []);

  useEffect(() => { engineRef.current?.update(props); }, [props]);

  const point = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div ref={wrapRef} className="confluence-river-canvas" data-testid="confluence-river-canvas">
      <canvas ref={glRef} className="confluence-gl" aria-hidden="true" />
      <canvas
        ref={fxRef}
        className="confluence-fx"
        aria-label="Confluence pipeline river"
        onMouseMove={(event) => {
          const cursor = point(event);
          engineRef.current?.setPointer(cursor.x, cursor.y, true);
        }}
        onMouseLeave={() => engineRef.current?.setPointer(0, 0, false)}
        onClick={(event) => {
          const cursor = point(event);
          props.onSelect?.(engineRef.current?.pick(cursor.x, cursor.y) ?? null);
        }}
      />
    </div>
  );
});
