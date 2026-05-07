export function parseIssueIdFromText(value: string): string | null {
  const match = value.match(/\b([A-Za-z]+-\d+|F\d+|US\d+|DE\d+|TA\d+|TC\d+)\b/i);
  return match ? match[1]!.toUpperCase() : null;
}

export function parseContainerServiceName(fullName: string): string {
  const parts = fullName.split('-');
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]!)) {
    parts.pop();
  }
  const withoutInstance = parts.join('-');

  const issueId = parseIssueIdFromText(fullName);
  if (issueId) {
    const issueIdLower = issueId.toLowerCase();
    const idx = fullName.toLowerCase().indexOf(issueIdLower);
    if (idx >= 0) {
      const afterIssue = fullName.slice(idx + issueIdLower.length).replace(/^-/, '');
      const afterParts = afterIssue.split('-');
      if (afterParts.length > 1 && /^\d+$/.test(afterParts[afterParts.length - 1]!)) {
        afterParts.pop();
      }
      const serviceName = afterParts.join('-');
      if (serviceName) return serviceName;
    }
  }

  const fallbackParts = withoutInstance.split('-');
  return fallbackParts[fallbackParts.length - 1] || fullName;
}
