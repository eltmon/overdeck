/**
 * GitLab merge-request shapes the PR-facts reader parses: `glab mr view -F json`
 * and the `/merge_requests/:iid/approvals` endpoint. Split out of pr-facts.ts
 * (PAN-4540) to keep that file under the file-size ceiling.
 */

export interface GitLabMrView {
  iid?: number;
  state?: string;
  draft?: boolean;
  web_url?: string;
  sha?: string;
  source_branch?: string;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
  approvals_before_merge?: number | null;
  head_pipeline?: { status?: string } | null;
  pipeline?: { status?: string } | null;
}

/**
 * #4066 review: what GitLab's `/merge_requests/:iid/approvals` endpoint
 * reports. `glab mr view -F json` carries no approval at all, and the
 * endpoint's own `approved` is true whenever the project requires no approvals
 * (`approvals_required: 0`, as the MYN backend does), so only `approved_by`,
 * which `glab mr approve` fills, is evidence someone approved the MR.
 */
export interface GitLabMrApprovals {
  approved?: boolean;
  approvals_required?: number;
  approvals_left?: number;
  approved_by?: ReadonlyArray<{ user?: { username?: string | null } | null }> | null;
}
