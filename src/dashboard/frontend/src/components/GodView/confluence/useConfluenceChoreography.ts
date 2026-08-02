import { useEffect, useRef, type MutableRefObject } from 'react';
import { HOOKS, STAGE_COLORS, type HookFamilyKey, type Stage } from './model';
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
  | { type: 'sun' }
  | { type: 'spawn'; issueId: string };

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
    if (orb.state === 'stale') commands.push({ type: 'thaw', issueId: orb.id });
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

    if (before.mergeStatus !== 'merging' && orb.mergeStatus === 'merging') {
      commands.push({ type: 'merge', issueId: orb.id });
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

function eventKey(event: HookStreamEntry): string {
  return `${event.ts}:${event.agentId}:${event.hookName}:${event.tool}`;
}

export function useConfluenceChoreography(
  orbs: readonly ConfluenceOrb[],
  entries: readonly HookStreamEntry[],
  effectsRef: MutableRefObject<RiverEffectsApi | null>,
): void {
  const previousRef = useRef<Map<string, ConfluenceOrb> | null>(null);
  const seenEventsRef = useRef(new Set<string>());

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
