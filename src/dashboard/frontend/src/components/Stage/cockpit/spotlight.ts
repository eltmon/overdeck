import type { DerivedIssueState } from '../../../types'
import type { IssueActionKey } from '../../../lib/issueActions'

export type SpotlightTone = 'blocked' | 'ready'

export interface SpotlightState {
  tone: SpotlightTone
  /** Short headline, e.g. "Changes requested". */
  title: string
  /** The reason text. */
  detail?: string
  /** Action keys to surface as buttons, in priority order. The component
   *  resolves these against the live IssueActionMenu registry and only renders
   *  the ones that are currently enabled. */
  actionKeys: IssueActionKey[]
  /** Right-aligned chip text. */
  chip?: string
}

/**
 * deriveSpotlight — the single most important thing about this issue right now,
 * or null when nothing is blocking / ready. Surfaced as the band's hero banner
 * so a stuck issue announces *why* it is stuck instead of burying the reason in
 * a plan-DAG node (Command Deck remodel S3).
 *
 * Pure: derived issue state in → banner out. Every branch reads an owner —
 * the attention signal, the PR's review state, its checks, its mergeability.
 */
export function deriveSpotlight(
  issue: DerivedIssueState | undefined | null,
): SpotlightState | null {
  if (!issue) return null

  if (issue.attention === 'api-error') {
    return {
      tone: 'blocked',
      title: 'Provider errors',
      detail: 'The agent is hitting API errors and cannot make progress.',
      actionKeys: ['recoverAgent', 'tell'],
    }
  }
  if (issue.attention === 'stuck') {
    return {
      tone: 'blocked',
      title: 'Stuck',
      detail: 'Nothing has moved here for a while.',
      actionKeys: ['recoverAgent', 'tell', 'viewPr'],
    }
  }
  if (issue.state === 'changes-requested') {
    return {
      tone: 'blocked',
      title: 'Changes requested',
      detail: 'The reviewer asked for changes on the pull request.',
      actionKeys: ['tell', 'viewPr'],
    }
  }
  if (issue.pr?.checks === 'red') {
    return {
      tone: 'blocked',
      title: 'Checks are failing',
      detail: 'The pull request has failing checks; nothing merges until they pass.',
      actionKeys: ['tell', 'viewPr'],
    }
  }
  if (issue.pr && issue.pr.mergeable === false) {
    return {
      tone: 'blocked',
      title: 'Branch conflicts with main',
      detail: 'The forge will not merge this branch until the conflict is resolved.',
      actionKeys: ['syncMain', 'viewPr'],
    }
  }
  if (issue.state === 'ready') {
    return {
      tone: 'ready',
      title: 'Ready to merge',
      detail: 'Approved, checks green, no conflicts.',
      actionKeys: ['merge', 'viewPr'],
    }
  }
  return null
}
