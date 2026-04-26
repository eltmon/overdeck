/**
 * Derive round markers from reviewer roundMetadata + conversation messages.
 *
 * Matches each round's endedAt to the last message whose createdAt is <= round end.
 * Exported as a pure function for testability (PAN-847 pan-0h5k).
 */

import type { RoundMarker } from '../components/chat/MessagesTimeline';
import type { ReviewerRoundMetadata } from '@panopticon/contracts';

interface TimestampedItem {
  id: string;
  createdAt: string;
}

export function deriveRoundMarkers(
  roundMetadata: ReviewerRoundMetadata | undefined,
  items: readonly TimestampedItem[],
): RoundMarker[] {
  if (!roundMetadata?.history?.length || items.length === 0) return [];

  const markers: RoundMarker[] = [];
  for (const round of roundMetadata.history) {
    if (!round.endedAt) continue;
    const endTs = new Date(round.endedAt).getTime();

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
