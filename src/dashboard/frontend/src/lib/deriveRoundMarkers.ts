/**
 * Derive round markers from reviewer roundMetadata + conversation messages.
 *
 * Matches each round's endedAt to the last message whose createdAt is <= round end.
 * Exported as a pure function for testability (PAN-847 pan-0h5k).
 *
 * PAN-915 — when reviewer sessions persisted only within a single round (the
 * pre-PAN-915 behavior), the agents/<session>/round-N.json metadata could
 * outlive the per-session JSONL: a kill+respawn would carry round metadata
 * forward but discard prior rounds' messages. That left "orphan" rounds whose
 * `endedAt` predates the first message visible in the current transcript, and
 * they all collapsed onto the last-message fallback — bunching every old
 * round at the bottom of the conversation. We now drop those markers; they
 * still surface in the Findings tab via roundMetadata.history. Forward-going
 * (PAN-915 cross-round persistence) all rounds share one JSONL and anchor
 * correctly.
 */

import type { RoundMarker } from '../components/chat/MessagesTimeline';
import type { ReviewerRoundMetadata } from '@panctl/contracts';

interface TimestampedItem {
  id: string;
  createdAt: string;
}

export function deriveRoundMarkers(
  roundMetadata: ReviewerRoundMetadata | undefined,
  items: readonly TimestampedItem[],
): RoundMarker[] {
  if (!roundMetadata?.history?.length || items.length === 0) return [];

  // First message timestamp — anchors the lower bound for "this round's
  // messages are visible in the current transcript".
  const firstItemTs = new Date(items[0]!.createdAt).getTime();

  const markers: RoundMarker[] = [];
  for (const round of roundMetadata.history) {
    if (!round.endedAt) continue;
    const endTs = new Date(round.endedAt).getTime();

    // Drop markers for rounds that ended before the conversation transcript
    // begins — their messages are in a different JSONL (legacy respawn) and
    // pinning them here would just bunch them onto the last-message fallback.
    // The Findings tab still surfaces them via roundMetadata.history.
    if (Number.isFinite(endTs) && endTs < firstItemTs) continue;

    let afterId = '';
    for (let i = items.length - 1; i >= 0; i--) {
      const itemTs = new Date(items[i]!.createdAt).getTime();
      if (itemTs <= endTs) {
        afterId = items[i]!.id;
        break;
      }
    }

    if (!afterId && items.length > 0) {
      afterId = items[items.length - 1]!.id;
    }

    let verdict: RoundMarker['verdict'];
    switch (round.status) {
      case 'passed':
      case 'approved':
        verdict = 'passed';
        break;
      case 'failed':
      case 'blocked':
        verdict = 'failed';
        break;
      case 'running':
      case 'active':
        verdict = 'running';
        break;
      default:
        verdict = 'pending';
    }

    markers.push({
      afterMessageId: afterId,
      round: round.round,
      verdict,
      label: round.status,
    });
  }

  return markers;
}
