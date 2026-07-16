export interface MailboxActionStatus {
  reviewStatus?: string;
  testStatus?: string;
  verificationStatus?: string;
}

let reader: ((issueId: string) => MailboxActionStatus | null) | undefined;

export function registerMailboxStatusReader(
  next: (issueId: string) => MailboxActionStatus | null,
): void {
  reader = next;
}

export function readMailboxActionStatus(issueId: string): MailboxActionStatus | null {
  return reader?.(issueId) ?? null;
}
