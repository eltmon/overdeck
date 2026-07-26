export function formatIssueRef(
  issueId?: string | null,
  title?: string | null,
): string | null {
  const id = issueId?.trim();
  if (!id) return null;

  const issueTitle = title?.trim();
  return issueTitle ? `${id} — ${issueTitle}` : id;
}
