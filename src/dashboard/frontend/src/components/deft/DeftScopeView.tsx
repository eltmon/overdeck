/**
 * Deft's scopes in the cockpit Plan › Tasks view (PAN-4849 WI-11, BD-1,
 * PAN-4820 AD-12). A Deft issue's Overdeck plan is a one-item placeholder,
 * so the real work units show here: scopes by folder, items with evidence
 * and disposition, and a Sign off button for a disposition Deft will not
 * accept yet (no provenance, or an agent's).
 */
import type { DeftScope, DeftScopeItem } from '@overdeck/contracts';
import { toast } from 'sonner';
import { CockpitCard, CockpitPill } from '../Stage/cockpit/CockpitCard';
import { DEFT_FOLDER_LABELS } from './DeftScopeSummary';
import { useDeftIssueState, useSignOffScope } from './queries';

const HUMAN_PROVENANCE = new Set(['operator-cli', 'operator-session', 'human-event']);

export function needsSignOff(item: DeftScopeItem): boolean {
  return item.disposition !== undefined && !HUMAN_PROVENANCE.has(item.disposition.provenanceKind ?? '');
}

function ItemRow({ issueId, scope, item }: { issueId: string; scope: DeftScope; item: DeftScopeItem }) {
  const signOff = useSignOffScope(issueId);
  return (
    <li data-testid={`deft-item-${scope.planId}-${item.id}`} className="py-1 text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <CockpitPill tone="muted">{item.status || 'unknown'}</CockpitPill>
        <span className="text-foreground">{item.title || item.id}</span>
      </div>
      {item.evidence ? (
        <p className="font-mono text-[11px] text-muted-foreground">{item.evidence.kind}: {item.evidence.pointer}</p>
      ) : null}
      {item.disposition ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{item.disposition.disposition}{item.disposition.reason ? ` — ${item.disposition.reason}` : ''}</span>
          <span className="font-mono">{item.disposition.provenanceKind ?? 'no provenance'}</span>
          {needsSignOff(item) ? (
            <button
              type="button"
              disabled={signOff.isPending}
              onClick={() => signOff.mutate(
                { scopePath: scope.path, itemId: item.id },
                { onError: (error) => toast.error(`Sign-off failed: ${(error as Error).message}`) },
              )}
              className="rounded border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
            >
              Sign off
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function DeftScopeView({ issueId }: { issueId: string }) {
  const { data: state } = useDeftIssueState(issueId);
  if (!state || state.scopes.length === 0) return null;
  return (
    <div data-section="Deft scopes" className="mb-3.5 space-y-3.5">
      {DEFT_FOLDER_LABELS.map(([folder, label]) => {
        const scopes = state.scopes.filter((scope) => scope.folder === folder);
        if (scopes.length === 0) return null;
        return (
          <CockpitCard key={folder} tone="muted" title={`Deft scopes · ${label}`}>
            <div className="space-y-3">
              {scopes.map((scope) => (
                <section key={scope.path}>
                  <p className="text-[13px] font-medium text-foreground">
                    {scope.title || scope.planId} <span className="font-mono text-[11px] text-muted-foreground">{scope.planId}</span>
                  </p>
                  <ul>{scope.items.map((item) => <ItemRow key={item.id} issueId={issueId} scope={scope} item={item} />)}</ul>
                </section>
              ))}
            </div>
          </CockpitCard>
        );
      })}
    </div>
  );
}
