/**
 * Palette conversation hits from linked machines (PAN-4651 FR-5, D-4651-16).
 *
 * `useFleetSearchActions` runs `GET /api/fleet/search` beside the palette's own
 * search and turns each linked machine's hits into palette rows grouped
 * "On <label>". Hit names arrive as `@<env>/<name>`; choosing one opens
 * `/conv/@<env>/<name>`, which the linked-conversation proxy serves. A machine
 * that failed (timeout, older Overdeck) contributes no rows.
 */
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';

import { buildConversationUrl } from '../App/routes';
import { describeConversationHit, type PaletteConversationHit } from './palette-conversation-hits';

export interface FleetSearchMachine {
  environmentId: string;
  label: string;
  conversations: PaletteConversationHit[];
  error?: string;
}

export async function fetchFleetSearch(query: string, signal: AbortSignal): Promise<FleetSearchMachine[]> {
  try {
    const res = await fetch(`/api/fleet/search?q=${encodeURIComponent(query)}&limit=15`, { signal });
    if (!res.ok) return [];
    const body = await res.json() as { machines?: unknown };
    return Array.isArray(body.machines) ? body.machines as FleetSearchMachine[] : [];
  } catch {
    return [];
  }
}

/** Rows shaped like the palette's own conversation rows; `group` is "On <label>". */
export function fleetHitActions(machines: ReadonlyArray<FleetSearchMachine>, open: (url: string) => void = defaultOpen) {
  return machines.flatMap((machine) => (Array.isArray(machine.conversations) ? machine.conversations : []).map((hit) => {
    const described = describeConversationHit(hit);
    return {
      id: `fleet-${hit.conversationId}-${hit.byteOffset ?? 'title'}`,
      label: described.label,
      description: `${machine.label} · ${described.sourceLabel}`,
      icon: MessageCircle,
      group: `On ${machine.label}`,
      rank: hit.rank,
      sortTs: hit.ts,
      tier: described.tier,
      excerptSegments: (hit.excerptSegments ?? []).map((seg) => ({ kind: seg.match ? 'match' as const : 'text' as const, value: seg.text })),
      keywords: ['conversation', machine.label, hit.conversationId, hit.title ?? ''],
      onSelect: () => open(buildConversationUrl(hit.conversationId)),
    };
  }));
}

function defaultOpen(url: string): void {
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The fleet rows for the palette's debounced query (none below two characters or while closed). */
export function useFleetSearchActions(isOpen: boolean, query: string) {
  const [machines, setMachines] = useState<FleetSearchMachine[]>([]);
  useEffect(() => {
    const trimmed = query.trim();
    if (!isOpen || trimmed.length < 2) {
      setMachines([]);
      return;
    }
    const controller = new AbortController();
    void fetchFleetSearch(trimmed, controller.signal).then((next) => { if (!controller.signal.aborted) setMachines(next); });
    return () => controller.abort();
  }, [isOpen, query]);
  return useMemo(() => fleetHitActions(machines), [machines]);
}
