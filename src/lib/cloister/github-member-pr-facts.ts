/**
 * One GitHub member repo's PR facts, read by URL (PAN-5638).
 *
 * `getPrFacts(issueId)` finds an issue's PR through the project's
 * `github_repo` (`resolveGitHubPullRequestRepo`), which a polyrepo member
 * repo is not — a Linear- or GitLab-tracked polyrepo project has no
 * `github_repo` at all. The polyrepo verdict write and the ready set both
 * need to read a GitHub member PR on its own, by the URL its member
 * discovery already returned, under the same marker trust rules `pr-facts`
 * applies everywhere else.
 */
import { fetchPullRequestByNumber } from '../overdeck/pull-requests.js';
import { emptyPrFacts, forgeApprovalAtHead, gitHubPrFacts, type PrFacts, type PrFactsDeps } from './pr-facts.js';

const GITHUB_PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export interface GitHubMemberPrFactsDeps extends PrFactsDeps {
  fetchPr?: typeof fetchPullRequestByNumber;
  /** A trusted standing review of the head (`forgeApprovalAtHead`); used by the ready-set read only. */
  standingApproval?: (facts: PrFacts) => Promise<boolean | undefined>;
}

/** One GitHub member PR's facts, read from its URL under the marker trust rules. Never throws. */
export async function readGitHubMemberPrFacts(issueId: string, url: string, deps: GitHubMemberPrFactsDeps = {}): Promise<PrFacts> {
  const match = url.match(GITHUB_PR_URL);
  if (!match) return emptyPrFacts(issueId, `unrecognized GitHub PR URL ${url}`);
  const { fetchPr = fetchPullRequestByNumber, standingApproval: _standingApproval, ...factsDeps } = deps;
  try {
    const read = await fetchPr(issueId, `${match[1]}/${match[2]}`, Number(match[3]));
    if (!read.pr) return emptyPrFacts(issueId, read.error ?? `GitHub PR ${url} could not be read`);
    return await gitHubPrFacts(issueId, read.pr, factsDeps);
  } catch (cause) {
    return emptyPrFacts(issueId, `GitHub PR lookup failed for ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * The ready set's read: the member PR's facts, with a trusted standing review
 * of the head folded into `approved`. A real review by the GitHub App on an
 * unprotected branch sets no `reviewDecision` and posts no marker.
 */
export async function readGitHubMemberReadyFacts(issueId: string, url: string, deps: GitHubMemberPrFactsDeps = {}): Promise<PrFacts> {
  const facts = await readGitHubMemberPrFacts(issueId, url, deps);
  if (facts.error || facts.approved || facts.changesRequested || !facts.open || facts.draft) return facts;
  return (await (deps.standingApproval ?? forgeApprovalAtHead)(facts)) === true ? { ...facts, approved: true } : facts;
}
