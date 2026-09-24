/**
 * Finding an issue's Herdr workspaces after a session restore (#4096).
 *
 * `workspaceFor` (`./herdr.ts`) creates every issue workspace with
 * `label: issueId` and stamps it with the `issue` token. A Herdr session restore
 * drops workspace and pane tokens and keeps labels. Seen live on 2026-09-24:
 * 16 of 17 workspaces had lost their `issue` token, every one still carried its
 * issue id as its label, and a token-only lookup had created a second
 * `sequencer-runner` workspace beside the restored one.
 */

import type { HerdrApiClient } from './herdr-api.js';

export interface HerdrWorkspaceInfo {
  workspace_id: string;
  label?: string;
  tokens?: Record<string, string>;
}

/**
 * Does this workspace belong to the issue? By its `issue` token, or by its label
 * when it carries no `issue` token at all. The token wins: a label can be
 * renamed in the TUI, so a workspace stamped for another issue is never matched
 * by its label.
 */
export function workspaceBelongsToIssue(
  workspace: { readonly label?: string; readonly tokens?: Record<string, string> },
  issueId: string,
): boolean {
  const wanted = issueId.toLowerCase();
  const issue = workspace.tokens?.issue;
  if (issue) return issue.toLowerCase() === wanted;
  return workspace.label?.toLowerCase() === wanted;
}

/** Every workspace of the issue, tagged ones first. Throws when the socket does not answer. */
export async function listIssueWorkspaces(api: HerdrApiClient, issueId: string): Promise<HerdrWorkspaceInfo[]> {
  const listed = await api.call<{ workspaces?: HerdrWorkspaceInfo[] }>('workspace.list', {});
  const matches = (listed.workspaces ?? []).filter((workspace) => workspaceBelongsToIssue(workspace, issueId));
  return [...matches.filter((w) => w.tokens?.issue), ...matches.filter((w) => !w.tokens?.issue)];
}

/**
 * The issue's existing workspace id, or null when it has none. A workspace found
 * only by its label is re-adopted: its `issue` token is stamped back, so the
 * next lookup and every token reader find it again.
 */
export async function adoptIssueWorkspace(
  api: HerdrApiClient,
  issueId: string,
  metadataSource: string,
): Promise<string | null> {
  const [workspace] = await listIssueWorkspaces(api, issueId);
  if (!workspace) return null;
  if (!workspace.tokens?.issue) {
    await api.call('workspace.report_metadata', {
      workspace_id: workspace.workspace_id,
      source: metadataSource,
      tokens: { issue: issueId },
    });
  }
  return workspace.workspace_id;
}
