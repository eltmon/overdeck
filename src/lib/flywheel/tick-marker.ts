/**
 * The tick marker contract (PAN-3964 FR-2, D3).
 *
 * The `pan-flywheel` skill ends every tick by printing one line:
 *
 *   flywheel-tick: tick=3 pick=PAN-3964 phase=watch in-flight=PAN-3964,PAN-3920 needs-you=none
 *
 * The dashboard and the CLI both read the flywheel conversation's transcript
 * and parse the newest marker with `parseTickMarker`. The marker is the only
 * channel from the loop to the page — there is no status endpoint and nothing
 * is stored. `needs-you` is always the last key and takes the rest of the line,
 * so free text may contain spaces and `=`.
 */

import { needsYouItemKey, splitNeedsYouItems, type FlywheelNeedsYouItem, type TickMarker, type TickMarkerPhase } from '@overdeck/contracts';

export type { TickMarker, TickMarkerPhase };

export const TICK_MARKER_PREFIX = 'flywheel-tick:';

const PHASES: ReadonlySet<TickMarkerPhase> = new Set<TickMarkerPhase>([
  'orient', 'pick', 'launch', 'watch', 'park', 'idle', 'stopping',
]);

export function formatTickMarker(t: TickMarker): string {
  const inFlight = t.inFlight.length ? t.inFlight.join(',') : 'none';
  return `${TICK_MARKER_PREFIX} tick=${t.tick} pick=${t.pick ?? 'none'} phase=${t.phase} in-flight=${inFlight} needs-you=${t.needsYou ?? 'none'}`;
}

function noneToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trimmed === 'none' ? null : trimmed;
}

function parseLine(line: string): TickMarker | null {
  const start = line.indexOf(TICK_MARKER_PREFIX);
  if (start === -1) return null;
  let body = line.slice(start + TICK_MARKER_PREFIX.length).trim();
  // Markdown renderers and some harnesses wrap the line in backticks.
  body = body.replace(/`+\s*$/, '');

  let needsYou: string | null = null;
  const needsIdx = body.search(/(?:^|\s)needs-you=/);
  if (needsIdx !== -1) {
    const valueStart = body.indexOf('needs-you=', needsIdx) + 'needs-you='.length;
    needsYou = noneToNull(body.slice(valueStart));
    body = body.slice(0, needsIdx);
  }

  const fields = new Map<string, string>();
  for (const token of body.split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    fields.set(token.slice(0, eq), token.slice(eq + 1));
  }

  const tick = Number(fields.get('tick'));
  if (!Number.isFinite(tick)) return null;
  const rawPhase = fields.get('phase') ?? '';
  const phase: TickMarkerPhase = PHASES.has(rawPhase as TickMarkerPhase) ? (rawPhase as TickMarkerPhase) : 'watch';
  const inFlightRaw = noneToNull(fields.get('in-flight'));
  return {
    tick,
    pick: noneToNull(fields.get('pick')),
    phase,
    inFlight: inFlightRaw ? inFlightRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    needsYou,
  };
}

/** Parse the last valid marker line in `text`, or `null` when there is none. */
export function parseTickMarker(text: string): TickMarker | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseLine(lines[i] ?? '');
    if (parsed) return parsed;
  }
  return null;
}

/** The minimal message shape the finder needs — `ChatMessage` satisfies it. */
export interface TickMarkerMessage {
  role: string;
  text: string;
  createdAt: string;
  id?: string;
}

/**
 * The newest tick from a transcript, oldest-first. Only assistant messages
 * count: the stop and report requests the operator sends contain a
 * `flywheel-tick:` template, and the skill's own example lands in a user
 * turn when the slash command expands.
 */
export function findLastTick(
  messages: readonly TickMarkerMessage[],
): (TickMarker & { at: string; messageId?: string }) | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant' || !message.text.includes(TICK_MARKER_PREFIX)) continue;
    const parsed = parseTickMarker(message.text);
    if (parsed) return { ...parsed, at: message.createdAt, ...(message.id ? { messageId: message.id } : {}) };
  }
  return null;
}

/**
 * The newest tick's needs-you items, each with the oldest tick message of its
 * current unbroken run (PAN-5198). Walks tick messages newest first, using the
 * same assistant-only rule as `findLastTick`, and stops once every item's run
 * has ended. A run that reaches the oldest tick in `messages` ends there.
 */
export function resolveNeedsYouItems(messages: readonly TickMarkerMessage[]): FlywheelNeedsYouItem[] {
  type Seen = { tick: number; at: string; messageId?: string };
  let items: Array<{ text: string; key: string; first: Seen }> | null = null;
  const open = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant' || !message.text.includes(TICK_MARKER_PREFIX)) continue;
    const parsed = parseTickMarker(message.text);
    if (!parsed) continue;
    const here: Seen = { tick: parsed.tick, at: message.createdAt, ...(message.id ? { messageId: message.id } : {}) };
    if (items === null) {
      items = splitNeedsYouItems(parsed.needsYou).map((text) => ({ text, key: needsYouItemKey(text), first: here }));
      for (const item of items) open.add(item.key);
    } else {
      const keys = new Set(splitNeedsYouItems(parsed.needsYou).map(needsYouItemKey));
      for (const item of items) {
        if (!open.has(item.key)) continue;
        if (keys.has(item.key)) item.first = here;
        else open.delete(item.key);
      }
    }
    if (open.size === 0) break;
  }
  return (items ?? []).map(({ text, first }) => ({
    text,
    firstRaisedTick: first.tick,
    firstRaisedAt: first.at,
    ...(first.messageId ? { firstRaisedMessageId: first.messageId } : {}),
  }));
}
