/**
 * The Anywhere status card (PAN-4445 FR-11): this machine, the addresses other
 * devices can reach, the paired-device count, the Session Vault state, and
 * each problem with a fix button. Problems come from the server
 * (`GET /api/anywhere/status`); this card maps each `action.kind` to a button
 * and never tells the operator to run a command.
 */
import { useQuery } from '@tanstack/react-query';

import {
  ANYWHERE_STATUS_QUERY_KEY,
  loadAnywhereStatus,
  type AnywhereAction,
  type AnywhereProblem,
  type AnywhereStatus,
} from './anywhereApi';

interface AnywhereStatusCardProps {
  onAction: (action: AnywhereAction) => void;
}

const SECONDARY_BUTTON = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors';

function vaultText(vault: AnywhereStatus['vault']): string {
  switch (vault.state) {
    case 'off':
      return 'Not set up';
    case 'locked':
      return 'Locked on this machine';
    case 'rotation-pending':
      return 'Key rotation unfinished';
    case 'ready':
      return vault.backend ? `Ready (${vault.backend})` : 'Ready';
  }
}

function ProblemFix({ problem, onAction }: { problem: AnywhereProblem; onAction: (action: AnywhereAction) => void }) {
  const { action } = problem;
  if (action.kind === 'pair-dialog') {
    return <button type="button" className={SECONDARY_BUTTON} onClick={() => onAction(action)}>Add an address</button>;
  }
  if (action.kind === 'settings-section') {
    return <button type="button" className={SECONDARY_BUTTON} onClick={() => onAction(action)}>Open Session Vault</button>;
  }
  if (action.docsUrl) {
    return (
      <a href={action.docsUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline">
        How to fix
      </a>
    );
  }
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-xs text-foreground text-right min-w-0">{children}</dd>
    </div>
  );
}

export function AnywhereStatusCard({ onAction }: AnywhereStatusCardProps) {
  const { data: status, error, isLoading } = useQuery({
    queryKey: ANYWHERE_STATUS_QUERY_KEY,
    queryFn: loadAnywhereStatus,
    refetchInterval: 30_000,
  });

  return (
    <section
      aria-labelledby="anywhere-status-title"
      data-component="anywhere-status-card"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h3 id="anywhere-status-title" className="text-sm font-medium text-foreground mb-2">Anywhere</h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading Anywhere status…</p>
      ) : error || !status ? (
        <p className="text-xs text-muted-foreground">Anywhere status is unavailable.</p>
      ) : (
        <>
          <dl className="divide-y divide-border">
            <Row label="This machine">
              {status.machine ? (
                <>
                  {status.machine.label}{' '}
                  <span className="font-mono text-muted-foreground">{status.machine.environmentId.slice(0, 8)}</span>
                </>
              ) : 'Identity unreadable'}
            </Row>
            <Row label="Reachable at">
              {status.addresses.some((address) => !address.loopback) ? (
                <ul>
                  {status.addresses.filter((address) => !address.loopback).map((address) => (
                    <li key={address.origin} className="font-mono break-all">{address.origin}</li>
                  ))}
                </ul>
              ) : 'Only this machine'}
            </Row>
            <Row label="Paired devices">
              <span data-testid="anywhere-paired-devices" className="tabular-nums">{status.devices.active}</span>
            </Row>
            <Row label="Session Vault">
              <span className="inline-flex items-center gap-2">
                {vaultText(status.vault)}
                {status.vault.state === 'off' && (
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    onClick={() => onAction({ kind: 'settings-section', section: 'session-vault' })}
                  >
                    Set up
                  </button>
                )}
              </span>
            </Row>
          </dl>
          {status.problems.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label="Anywhere problems">
              {status.problems.map((problem) => (
                <li key={problem.code} className="flex items-start justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                  <span className="text-xs text-foreground">{problem.message}</span>
                  <ProblemFix problem={problem} onAction={onAction} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
