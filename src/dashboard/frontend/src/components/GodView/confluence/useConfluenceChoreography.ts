import { useEffect, useRef, type MutableRefObject } from 'react';
import type { DomainEvent } from '@overdeck/contracts';
import { subscribeDashboardDomainEvents } from '../../../lib/store';
import { HOOKS, STAGE_COLORS, SWEEP_BEAM_COLOR, SWEEP_FLARE_COLOR, type HookFamilyKey, type Stage } from './model';
import type { RiverEffectsApi } from './RiverCanvas';
import type { ConfluenceOrb, HookStreamEntry } from './useConfluenceData';

export const HOOK_HEAT_BUMP = 0.06;
export const HOOK_RATE_BUMP = 0.13;
export const TOOL_TICKER_CHANCE = 0.13;
export const FEED_TICKER_CHANCE = 0.16;

export type ChoreographyCommand =
  | { type: 'sparks'; issueId: string; color: string; agentId?: string; heatBump: number; specRateBump: number }
  | { type: 'ring'; issueId: string; color: string }
  | { type: 'ticker'; text: string; color: string }
  | { type: 'gate'; stage: Stage }
  | { type: 'merge'; issueId: string }
  | { type: 'tide'; targetId: string; beneficiaryId?: string }
  | { type: 'thaw'; issueId: string }
  | { type: 'sweep-tide' }
  | { type: 'flare'; issueId: string }
  | { type: 'sun' }
  | { type: 'spawn'; issueId: string };

/**
 * Sweep observation → visual command mapping (PAN-3490). Pure and fixture-tested.
 * sweep.scan (population changed) raises the lantern beam across the Doldrums;
 * sweep.escalated fires a signal flare off the orb. The sweeper is read-only,
 * so it never produces action or release choreography; the normal data stream
 * drives an orb's thaw when its state actually changes.
 */
export function planSweepCommands(events: readonly DomainEvent[]): ChoreographyCommand[] {
  const commands: ChoreographyCommand[] = [];
  let tideQueued = false;
  for (const event of events) {
    if (event.type === 'sweep.scan') {
      if (!tideQueued) {
        commands.push({ type: 'sweep-tide' });
        commands.push({ type: 'ticker', text: `🧹 sweeper scan · ${event.payload.issueCount} parked`, color: SWEEP_BEAM_COLOR });
        tideQueued = true;
      }
    } else if (event.type === 'sweep.escalated') {
      commands.push({ type: 'flare', issueId: event.payload.issueId });
      commands.push({ type: 'ticker', text: `⚑ ${event.payload.issueId} needs operator`, color: SWEEP_FLARE_COLOR });
    }
  }
  return commands;
}

interface ChoreographyFrame {
  previous: ReadonlyMap<string, ConfluenceOrb>;
  current: ReadonlyMap<string, ConfluenceOrb>;
  hookEvents: readonly HookStreamEntry[];
  random?: () => number;
}

function governorNamedBeneficiary(orb: ConfluenceOrb, current: ReadonlyMap<string, ConfluenceOrb>): string | undefined {
  const named = orb.yieldReason?.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0];
  if (!named || named === orb.id || !current.has(named)) return undefined;
  return named;
}

function latestReviewOrb(current: ReadonlyMap<string, ConfluenceOrb>): ConfluenceOrb | undefined {
  return [...current.values()]
    .filter((orb) => orb.stage === 'REVIEW' && orb.state === 'active')
    .sort((first, second) => Date.parse(second.lastActivity ?? '') - Date.parse(first.lastActivity ?? ''))[0];
}

function familyColor(family: HookFamilyKey): string {
  return HOOKS[family].color;
}

export function planConfluenceChoreography({
  previous,
  current,
  hookEvents,
  random = Math.random,
}: ChoreographyFrame): ChoreographyCommand[] {
  const commands: ChoreographyCommand[] = [];
  const reviewBeneficiary = latestReviewOrb(current)?.id;

  for (const event of hookEvents) {
    if (!event.issueId) continue;
    const orb = current.get(event.issueId);
    if (!orb) continue;
    const color = familyColor(event.family);
    // A beat on a frozen orb shows as sparks — NEVER a thaw. A single beat
    // (a delivery echo, a restore banner hook, one PostCompact) is not
    // re-engagement; the thaw plays only when the enrichment-confirmed
    // agent data flips the orb out of 'stale' (see the diff loop below).
    // Beat-driven thaws were the pop-and-snap-back flicker the operator
    // reported: orb rises on a beat, real lastActivity stays ancient, the
    // next reconcile slams it back into the Doldrums.
    commands.push({
      type: 'sparks',
      issueId: orb.id,
      color,
      agentId: event.agentId,
      heatBump: HOOK_HEAT_BUMP,
      specRateBump: HOOK_RATE_BUMP,
    });
    if (random() < TOOL_TICKER_CHANCE) {
      commands.push({ type: 'ticker', text: `${orb.id} · ${event.tool}`, color });
    }
    if (random() < FEED_TICKER_CHANCE) {
      commands.push({ type: 'ticker', text: `${event.hookName} · ${orb.id}`, color });
    }
  }

  for (const orb of current.values()) {
    const before = previous.get(orb.id);
    if (!before) {
      if (orb.role === 'plan') {
        commands.push({ type: 'sun' }, { type: 'spawn', issueId: orb.id });
      }
      continue;
    }

    if (orb.stage !== before.stage) {
      const color = STAGE_COLORS[orb.stage];
      commands.push(
        { type: 'ring', issueId: orb.id, color },
        { type: 'sparks', issueId: orb.id, color, heatBump: 0, specRateBump: 0 },
        { type: 'gate', stage: orb.stage },
      );
    }

    // The honest thaw: the enrichment-confirmed snapshot says the agent is
    // alive again (state flipped stale → anything else). One beat never
    // reaches this — it takes sustained, poller-confirmed activity.
    if (before.state === 'stale' && orb.state !== 'stale') {
      commands.push({ type: 'thaw', issueId: orb.id });
    }

    const yielded = orb.state === 'shelf' && (
      orb.yieldedByScheduler || orb.yieldReason?.toLowerCase().startsWith('yield:') === true
    );
    if (before.state !== 'shelf' && yielded) {
      const beneficiaryId = governorNamedBeneficiary(orb, current) ?? reviewBeneficiary;
      commands.push({ type: 'tide', targetId: orb.id, ...(beneficiaryId ? { beneficiaryId } : {}) });
    } else if (before.state === 'shelf' && orb.state !== 'shelf') {
      commands.push(
        { type: 'ring', issueId: orb.id, color: STAGE_COLORS.WORK },
        { type: 'sparks', issueId: orb.id, color: STAGE_COLORS.WORK, heatBump: 0, specRateBump: 0 },
      );
    }
  }

  return commands;
}

export function runConfluenceCommands(commands: readonly ChoreographyCommand[], effects: RiverEffectsApi): void {
  for (const command of commands) {
    switch (command.type) {
      case 'sparks':
        effects.emitSparks(command.issueId, command.color, command.agentId, command.heatBump);
        break;
      case 'ring':
        effects.emitRing(command.issueId, command.color);
        break;
      case 'ticker':
        effects.emitTicker(command.text, command.color);
        break;
      case 'gate':
        effects.gateFlash(command.stage);
        break;
      case 'merge':
        effects.playMerge(command.issueId);
        break;
      case 'tide':
        effects.playTide(command.targetId, command.beneficiaryId);
        break;
      case 'sweep-tide':
        effects.playSweep();
        break;
      case 'flare':
        effects.playFlare(command.issueId);
        break;
      case 'thaw':
        effects.playThaw(command.issueId);
        break;
      case 'sun':
        effects.pulseSun();
        break;
      case 'spawn':
        effects.spawnFromSun(command.issueId);
        break;
    }
  }
}

function orbMap(orbs: readonly ConfluenceOrb[]): Map<string, ConfluenceOrb> {
  return new Map(orbs.map((orb) => [orb.id, orb]));
}

function eventKey(event: HookStreamEntry): number {
  return event.sequence;
}

export function useConfluenceChoreography(
  orbs: readonly ConfluenceOrb[],
  entries: readonly HookStreamEntry[],
  effectsRef: MutableRefObject<RiverEffectsApi | null>,
): void {
  const previousRef = useRef<Map<string, ConfluenceOrb> | null>(null);
  const seenEventsRef = useRef(new Set<number>());

  useEffect(() => {
    const current = orbMap(orbs);
    const previous = previousRef.current;
    if (!previous) {
      previousRef.current = current;
      seenEventsRef.current = new Set(entries.map(eventKey));
      return;
    }

    const freshEvents = entries.filter((event) => !seenEventsRef.current.has(eventKey(event)));
    const nextSeen = new Set(entries.slice(-500).map(eventKey));
    const effects = effectsRef.current;
    if (effects) {
      runConfluenceCommands(planConfluenceChoreography({ previous, current, hookEvents: freshEvents }), effects);
    }
    previousRef.current = current;
    seenEventsRef.current = nextSeen;
  }, [effectsRef, entries, orbs]);
}

/**
 * Sweep choreography (PAN-3490). Subscribes to the raw domain-event stream for
 * sweep.* events and plays the sweeper's visuals — the lantern beam on
 * population change, thaws on release, flares on escalation. The first batch
 * seen after mount sets a sequence baseline WITHOUT playing: replays of
 * already-applied history (bootstrap/reconnect) must never re-animate ancient
 * sweeps — motion stays real.
 */
export function useSweepChoreography(
  effectsRef: MutableRefObject<RiverEffectsApi | null>,
): void {
  const baselineRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeDashboardDomainEvents((allEvents) => {
      // system.heartbeat carries no sequence — sequence is the replay guard.
      const events = allEvents.filter((event): event is Exclude<DomainEvent, { type: 'system.heartbeat' }> => 'sequence' in event);
      if (events.length === 0) return;
      const maxSequence = events.reduce((max, event) => Math.max(max, event.sequence), 0);
      if (baselineRef.current === null) {
        baselineRef.current = maxSequence;
        return;
      }
      const sweepEvents = events.filter((event) =>
        event.type.startsWith('sweep.') && event.sequence > (baselineRef.current ?? 0));
      if (maxSequence > (baselineRef.current ?? 0)) baselineRef.current = maxSequence;
      if (sweepEvents.length === 0) return;
      const effects = effectsRef.current;
      if (effects) runConfluenceCommands(planSweepCommands(sweepEvents), effects);
    });
    return unsubscribe;
  }, [effectsRef]);
}
