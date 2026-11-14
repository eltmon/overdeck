/**
 * The one derivation of the Flywheel's needs-you rows from its newest tick
 * (PAN-5198, PAN-5239, PAN-5306). The Needs-you selector and the Status tab's
 * action cards both build on these rows, so they agree on keys and text.
 */
import type { FlywheelLastTick } from '@overdeck/contracts';
import { needsYouItemKey, parseNeedsYouTarget, splitNeedsYouItems } from '@overdeck/contracts';

export interface NeedsYouRow {
  key: string;
  text: string;
  /** `text` without its trailing `<https://…>` target. */
  label: string;
  target?: string;
  /** The first-raised tick message's id, when the server sent one. */
  messageId?: string;
  /** The first-raised tick message's prose (PAN-5283 D18). */
  context?: string;
  firstRaisedTick?: number;
  firstRaisedAt?: string;
}

/** One row per item; the server's first-raised id, when it sent one (PAN-5198, PAN-5239). */
export function needsYouRows(tick: FlywheelLastTick): NeedsYouRow[] {
  const items = tick.needsYouItems ?? splitNeedsYouItems(tick.needsYou).map((text) => ({ text }));
  return items.map((item) => {
    const { label, target } = parseNeedsYouTarget(item.text);
    return {
      key: needsYouItemKey(item.text),
      text: item.text,
      label,
      ...(target ? { target } : {}),
      ...('firstRaisedMessageId' in item && item.firstRaisedMessageId ? { messageId: item.firstRaisedMessageId } : {}),
      ...('context' in item && item.context ? { context: item.context } : {}),
      ...('firstRaisedTick' in item ? { firstRaisedTick: item.firstRaisedTick, firstRaisedAt: item.firstRaisedAt } : {}),
    };
  });
}
