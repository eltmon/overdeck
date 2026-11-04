/**
 * Changed files checked against Deft's approved scopes (PAN-4849 WI-16).
 *
 * A path is in scope when it equals an approved entry or sits under an entry
 * that ends in `/`. Glob entries (containing `*`) are not evaluated, because
 * the dashboard has no glob matcher; they are listed as unchecked instead.
 * The Deft state archive under `.pan/deft/` is always in scope.
 */
import type { DeftApprovedScope } from '@overdeck/contracts';
import { useDeftIssueState } from './queries';

const ARCHIVE_PREFIX = '.pan/deft/';

function approvedEntries(approved: DeftApprovedScope[]): string[] {
  return [...new Set(approved.flatMap((scope) => scope.fileScope))];
}

export function outOfScopeFiles(changed: string[], approved: DeftApprovedScope[]): string[] {
  const entries = approvedEntries(approved).filter((entry) => !entry.includes('*'));
  return changed.filter((path) =>
    !path.startsWith(ARCHIVE_PREFIX)
    && !entries.some((entry) => path === entry || (entry.endsWith('/') && path.startsWith(entry))));
}

export function ApprovedScopeCheck({ issueId, files }: { issueId: string; files: string[] }) {
  const { data: state } = useDeftIssueState(issueId);
  if (!state || state.approvedScopes.length === 0) return null;
  const outside = outOfScopeFiles(files, state.approvedScopes);
  const unchecked = approvedEntries(state.approvedScopes).filter((entry) => entry.includes('*'));
  return (
    <div data-section="Deft approved scope" className="mb-2 rounded border border-border px-3 py-2 text-[12px]">
      {outside.length === 0
        ? <p className="text-muted-foreground">All changed files are in the approved scope</p>
        : (
          <>
            <p className="font-medium text-foreground">Outside approved scope:</p>
            <ul className="font-mono text-[11px] text-foreground">{outside.map((path) => <li key={path}>{path}</li>)}</ul>
          </>
        )}
      {unchecked.length > 0 ? (
        <p className="mt-1 text-muted-foreground">Unchecked patterns: <span className="font-mono">{unchecked.join(', ')}</span></p>
      ) : null}
    </div>
  );
}
