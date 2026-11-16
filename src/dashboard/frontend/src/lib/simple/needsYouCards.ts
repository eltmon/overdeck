/**
 * PAN-5371 · C-SIMPLE — one Needs-you card per shared selector item, plus
 * the two secondary sections (Ready to start / Having trouble) for the
 * Simple reasons the shared selector does not count (N-D3, N-D5, N-D6).
 *
 * Pure functions only — `SimpleHomePage` composes them. Imports only types
 * from ./derive and ../selectors/needsYou: `fr7-conversation-pending-input.test.tsx`
 * mocks ./derive with a factory, so a value import from it would break that test.
 */
import type { NeedsYouItem } from '../selectors/needsYou';
import type { NeedsYouKind, SimpleHomeBuckets, SimpleIssueDerivation } from './derive';
import { SIMPLE_STRINGS } from './strings';

export type SimpleNeedsYouCardKind = NeedsYouKind | 'item';

export interface SimpleNeedsYouCard {
  item: NeedsYouItem;
  derivation: SimpleIssueDerivation | undefined;
  card: SimpleNeedsYouCardKind;
  /** Plain-language heading for an 'item' card (N-D5). */
  title: string;
}

/** The upper-case issue id of an `issue:<ID>` item, else undefined. */
export function issueIdOfItem(item: NeedsYouItem): string | undefined {
  return item.key.startsWith('issue:') ? item.key.slice('issue:'.length).toUpperCase() : undefined;
}

/** The upper-case ids of every `issue:<ID>` item (N-D6, N-D10). */
export function coveredIssueIds(items: readonly NeedsYouItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = issueIdOfItem(item);
    if (id) ids.add(id);
  }
  return ids;
}

/** N-D3/N-D5: one card per shared item, in the selector's order. `byIdentifier` is keyed by lower-case issue id. */
export function simpleNeedsYouCards(
  items: readonly NeedsYouItem[],
  byIdentifier: ReadonlyMap<string, SimpleIssueDerivation>,
): SimpleNeedsYouCard[] {
  return items.map((item) => {
    const issueId = issueIdOfItem(item);
    const derivation = issueId ? byIdentifier.get(issueId.toLowerCase()) : undefined;

    let card: SimpleNeedsYouCardKind;
    if (derivation && derivation.display.state === 'needs-you') {
      card = derivation.display.needsYouReason ?? 'problems';
    } else if (derivation && item.subject) {
      card = 'question';
    } else {
      card = 'item';
    }

    const title = card === 'item'
      ? (item.kind === 'flywheel' ? SIMPLE_STRINGS.home.waitingDecisionTitle : item.title)
      : item.title;

    return { item, derivation, card, title };
  });
}

export interface SimpleSecondarySections {
  readyToStart: SimpleIssueDerivation[];
  trouble: { derivation: SimpleIssueDerivation; kind: 'stuck' | 'problems' }[];
}

/** N-D6: the displaced Simple reasons, minus issues already listed as Needs-you cards. */
export function simpleSecondarySections(
  bucketNeedsYou: SimpleHomeBuckets['needsYou'],
  items: readonly NeedsYouItem[],
): SimpleSecondarySections {
  const covered = coveredIssueIds(items);
  const readyToStart: SimpleIssueDerivation[] = [];
  const trouble: { derivation: SimpleIssueDerivation; kind: 'stuck' | 'problems' }[] = [];

  for (const entry of bucketNeedsYou) {
    if (covered.has(entry.derivation.issue.identifier.toUpperCase())) continue;
    if (entry.kind === 'start-work') {
      readyToStart.push(entry.derivation);
    } else if (entry.kind === 'stuck' || entry.kind === 'problems') {
      trouble.push({ derivation: entry.derivation, kind: entry.kind });
    }
    // entry.kind === 'question': not shown outside the shared list (N-D6).
  }

  return { readyToStart, trouble };
}
