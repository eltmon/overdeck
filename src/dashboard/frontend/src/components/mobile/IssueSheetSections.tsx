/** Sections of the issue sheet moved out of MobileIssueSheet.tsx to keep it small (PAN-5219 WI-5). */

export function SheetHeader({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border pt-[env(safe-area-inset-top)]">
      <button type="button" onClick={onBack} className="min-h-11 min-w-11 text-sm text-foreground">
        Back
      </button>
      <span className="font-mono text-xs text-muted-foreground">{issueId}</span>
    </div>
  );
}

export function WhatHappened({ line }: { line: string }) {
  return (
    <p data-testid="mobile-issue-event" className="mt-3 break-words text-sm">
      <span className="block text-xs text-muted-foreground">What happened</span>
      {line}
    </p>
  );
}
