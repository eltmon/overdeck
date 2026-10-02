/**
 * "Hand off to another machine" (PAN-4455 FR-10..FR-12, D-8..D-11, D-15):
 * Hand off now settles this conversation into the Session Vault through the
 * vault-service queue and reports the version the other machine continues.
 * When the vault cannot take it, the tab names the reason and its fix and
 * never calls the route.
 */
import { useState } from 'react';

import type { AnywhereStatus } from '../../Settings/anywhere/anywhereApi';
import { handOffConversation, openSessionVaultSettings, type HandOffBody } from './continueOnDeviceApi';
import { HANDOFF_HARNESSES, useContinueOnDeviceStore, type ContinueTarget } from './continueOnDeviceStore';
import { useHandoffNoticeStore } from './handoffNoticeStore';

const SESSION_VAULT_DOCS = 'https://overdeck.ai/configuration/session-vault';
const BUTTON = 'rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';
const CODE = 'block rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground break-all';

type Outcome = { status: number; body: HandOffBody | { error?: string } | null };

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isHandOffBody(body: Outcome['body']): body is HandOffBody {
  return body !== null && typeof (body as { result?: unknown }).result === 'string';
}

function goToSessionVault(): void {
  openSessionVaultSettings();
  useContinueOnDeviceStore.getState().close();
}

function Unavailable({ target, status }: { target: ContinueTarget; status: AnywhereStatus }) {
  if (!HANDOFF_HARNESSES.has(target.harness)) {
    return <p className="text-xs text-muted-foreground">Hand-off works for Claude Code and Codex conversations. This conversation runs on {target.harness}.</p>;
  }
  switch (status.vault.state) {
    case 'off':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Hand-off needs the Session Vault, which is off on this machine.</p>
          <button type="button" onClick={goToSessionVault} className={BUTTON}>Set up</button>
        </div>
      );
    case 'locked':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">This machine cannot open the Session Vault until it is unlocked.</p>
          <button type="button" onClick={goToSessionVault} className={BUTTON}>Open Session Vault</button>
        </div>
      );
    case 'rotation-pending':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">A vault key rotation started on this machine has not finished.</p>
          <a href={SESSION_VAULT_DOCS} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">How to finish it</a>
        </div>
      );
    case 'ready':
      return null;
  }
}

function Result({ outcome }: { outcome: Outcome }) {
  const { status, body } = outcome;
  if (!isHandOffBody(body)) {
    return <p className="text-xs text-destructive">{body?.error ?? `Hand-off failed (${status}).`}</p>;
  }
  switch (body.result) {
    case 'saved': {
      const time = timeOf(body.savedAt);
      const next = `On your other machine, open "${body.title}" from ${body.machineLabel} and click Continue here.`;
      if (body.wipProblem) {
        return (
          <div className="space-y-2" data-testid="handoff-result">
            <p className="text-xs text-foreground">The conversation was saved (version {body.version}), but its code snapshot was not.</p>
            <p className="text-xs text-muted-foreground">{body.wipProblem.message}</p>
            {body.wipProblem.fix && <code className={CODE}>{body.wipProblem.fix}</code>}
          </div>
        );
      }
      return (
        <p className="text-xs text-foreground" data-testid="handoff-result">
          {body.forkedFrom
            ? `Saved as version ${body.version} at ${time} as a separate copy, because another machine already continued this conversation. ${next}`
            : `Saved as version ${body.version} at ${time}. ${next}`}
        </p>
      );
    }
    case 'blocked':
      return (
        <div className="space-y-2" data-testid="handoff-result">
          <p className="text-xs text-destructive">Not saved. The secret scan blocked:</p>
          <ul className="text-xs text-foreground">
            {body.hits.map((hit) => <li key={`${hit.line}-${hit.pattern}`}>line {hit.line}: {hit.pattern}</li>)}
          </ul>
          {body.fixes.map((fix) => <code key={fix} className={CODE}>{fix}</code>)}
          <p className="text-xs text-muted-foreground">After allowing a line, click Hand off now again.</p>
        </div>
      );
    case 'offline':
      return (
        <div className="space-y-2" data-testid="handoff-result">
          <p className="text-xs text-destructive">{body.error}</p>
          <code className={CODE}>{body.fix}</code>
        </div>
      );
    default:
      return <p className="text-xs text-destructive" data-testid="handoff-result">{body.error}</p>;
  }
}

export function HandOffTab({ target, status }: { target: ContinueTarget; status: AnywhereStatus }) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (!HANDOFF_HARNESSES.has(target.harness) || status.vault.state !== 'ready') {
    return <div className="text-sm"><Unavailable target={target} status={status} /></div>;
  }

  const handleHandOff = async () => {
    setPending(true);
    try {
      const result = await handOffConversation(target.name);
      setOutcome(result);
      const body = result.body;
      if (result.status === 200 && isHandOffBody(body) && body.result === 'saved' && body.wipProblem === null && target.sessionAlive) {
        useHandoffNoticeStore.getState().record(target.name, body.savedAt);
      }
    } catch (err) {
      setOutcome({ status: 0, body: { error: (err as Error).message } });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">Saves this conversation to the Session Vault now, so your other machine can continue it.</p>
      <button
        type="button"
        onClick={() => void handleHandOff()}
        disabled={pending}
        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {pending ? 'Handing off…' : 'Hand off now'}
      </button>
      {outcome && <Result outcome={outcome} />}
    </div>
  );
}
