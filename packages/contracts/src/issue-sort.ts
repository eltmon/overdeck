const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" })

/**
 * Compares issue identifiers numerically within their prefix, so PAN-532 sorts
 * before PAN-2822. Every issue-id sort should use this comparator (PAN-2831).
 */
export function compareIssueIds(a: string, b: string): number {
  return collator.compare(a, b)
}
