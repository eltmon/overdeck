
/** Extract an issue id from arbitrary text. Pure. */
export function parseIssueIdFromText(value: string): string | null {
  const match = value.match(/\b([A-Za-z]+-\d+|F\d+|US\d+|DE\d+|TA\d+|TC\d+)\b/i);
  return match ? match[1]!.toUpperCase() : null;
}
