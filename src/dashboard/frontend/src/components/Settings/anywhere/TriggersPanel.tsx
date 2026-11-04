import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { AddTriggerDialog, SetSigningSecretDialog } from './AddTriggerDialog';
import {
  ANYWHERE_TRIGGERS_QUERY_KEY,
  apiError,
  isOk,
  loadTriggers,
  removeTrigger,
  type TriggerRow,
} from './anywhereApi';

function targetText(trigger: TriggerRow): string {
  return trigger.target.kind === 'conversation'
    ? `Messages conversation ${trigger.target.conversation}`
    : `Starts a conversation in ${trigger.target.projectKey}`;
}

function verifyText(trigger: TriggerRow): string {
  if (trigger.verify === 'none') return 'No signature check';
  const kind = trigger.verify === 'github' ? 'GitHub' : 'Stripe';
  return `${kind} signature · ${trigger.signingSecretSet ? 'signing secret set' : 'signing secret not set'}`;
}

/** Webhook triggers on this machine: add one, set its signing secret, or remove it after an in-app confirmation (PAN-4648 FR-8). */
export function TriggersPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data, error, isLoading } = useQuery({
    queryKey: ANYWHERE_TRIGGERS_QUERY_KEY,
    queryFn: loadTriggers,
  });
  const triggers = data?.triggers ?? [];
  const [adding, setAdding] = useState(false);
  const [secretFor, setSecretFor] = useState<TriggerRow | null>(null);

  const handleRemove = async (trigger: TriggerRow) => {
    const confirmed = await confirm({
      title: `Remove ${trigger.name}?`,
      message: 'Its URL stops working at once. Senders that still use it get 404.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const result = await removeTrigger(trigger.id);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ANYWHERE_TRIGGERS_QUERY_KEY });
  };

  return (
    <div data-component="anywhere-triggers-panel">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">Triggers</h3>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/40 transition-colors"
        >
          Add trigger
        </button>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading triggers…</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load triggers: {(error as Error).message}</p>
      ) : triggers.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">
          No triggers. A trigger is a secret URL that sends a message to a conversation or starts one in a project.
        </p>
      ) : (
        <ul className="space-y-1">
          {triggers.map((trigger) => (
            <li
              key={trigger.id}
              data-trigger-id={trigger.id}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{trigger.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {targetText(trigger)}
                  {' · '}{verifyText(trigger)}
                  {trigger.inbox ? ' · inbox' : ''}
                  {' · '}created {formatRelativeTime(trigger.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {trigger.verify !== 'none' && (
                  <button
                    type="button"
                    onClick={() => setSecretFor(trigger)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/40 transition-colors"
                  >
                    Set signing secret
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRemove(trigger)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground px-4 pt-3">
        Events reach this machine directly through Tailscale Funnel; overdeck.ai never sees them.
      </p>
      {data?.funnel?.command ? (
        <code
          data-testid="trigger-funnel-command"
          className="mx-4 mt-1 block select-all overflow-x-auto whitespace-pre rounded-md border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground"
        >
          {data.funnel.command}
        </code>
      ) : null}
      <AddTriggerDialog open={adding} onClose={() => setAdding(false)} />
      <SetSigningSecretDialog trigger={secretFor} onClose={() => setSecretFor(null)} />
    </div>
  );
}
