/**
 * The exact phrase a caller sends as `hostOverrideConfirmation` to start an
 * agent on the host, outside the workspace Docker stack. The spawn route
 * (`POST /api/agents`) and the start-planning route (PAN-5498, which records
 * the override for the post-planning start) both require it.
 */
export function buildHostOverrideConfirmation(issueId: string): string {
  return `I understand this bypasses workspace isolation for ${issueId.toUpperCase()}`;
}
