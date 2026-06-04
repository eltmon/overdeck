import type { ReviewStatusData } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import type { IssueActionKey } from '../../../lib/issueActions'

export type SpotlightTone = 'blocked' | 'ready'

export interface SpotlightState {
  tone: SpotlightTone
  /** Short headline, e.g. "Review blocked". */
  title: string
  /** The reason text (reviewer finding, failing-check note, …). */
  detail?: string
  /** Action keys to surface as buttons, in priority order. The component
   *  resolves these against the live IssueActionMenu registry and only renders
   *  the ones that are currently enabled. */
  actionKeys: IssueActionKey[]
  /** Right-aligned chip text (e.g. verification cycle). */
  chip?: string
}

/**
 * deriveSpotlight — the single most important thing about this issue right now,
 * or null when nothing is blocking / ready. Surfaced as the band's hero banner
 * so a stuck issue announces *why* it is stuck instead of burying the reason in
 * a plan-DAG node (Command Deck remodel S3). Pure: review-status in → state out.
 */
export function deriveSpotlight(
  rs: ReviewStatusData | undefined | null,
): SpotlightState | null {
  if (!rs) return null

  if (rs.reviewStatus === 'blocked' || rs.reviewStatus === 'failed') {
    return {
      tone: 'blocked',
      title: rs.reviewStatus === 'blocked' ? 'Review blocked' : 'Review failed',
      detail: rs.reviewNotes,
      actionKeys: ['restartReview', 'tell', 'viewPr'],
    }
  }
  if (rs.verificationStatus === 'failed') {
    return {
      tone: 'blocked',
      title: 'Verification failed',
      detail: rs.verificationNotes,
      actionKeys: ['recoverReview', 'tell'],
    }
  }
  if (rs.testStatus === 'failed' || rs.testStatus === 'dispatch_failed') {
    return {
      tone: 'blocked',
      title: 'Tests failed',
      detail: rs.testNotes,
      actionKeys: ['reviewTest', 'recoverReview', 'tell'],
    }
  }
  if (rs.mergeStatus === 'failed') {
    return {
      tone: 'blocked',
      title: 'Merge failed',
      detail: rs.mergeNotes,
      actionKeys: ['syncMain', 'recoverReview'],
    }
  }
  if (rs.readyForMerge) {
    return {
      tone: 'ready',
      title: 'Ready to merge',
      detail: 'Review and tests passed — clear to merge.',
      actionKeys: ['viewPr'],
    }
  }
  return null
}
