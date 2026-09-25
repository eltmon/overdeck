import { useState } from 'react';

import { hasLiveAgent, type IssueActionEntry } from '../../lib/issueActions';
import { ActionDialogFrame } from './IssueActionMenu';
import type { UseIssueActionsResult } from './useIssueActions';

/**
 * PAN-4198 (D10) — the one restart affordance.
 *
 * It replaces Restart from plan, Complete work reset and Reset session, which
 * were three menu entries for two outcomes. The operator answers one question:
 * does the new run remember the old conversation?
 *
 * - Keep its memory: a live agent is stopped and relaunched with its context
 *   (`POST /restart {graceful:true}`); a stopped or crashed one is brought back
 *   (`POST /recover`), because /restart answers 409 `already-running` only for a
 *   live harness and /recover is the path built for a dead one.
 * - Fresh session: `POST /restart-fresh {spawn:true}` wipes the agent's state
 *   directory and spawns a new work agent. The workspace, branch, plan, tasks
 *   and commits all survive; only the saved conversation is discarded.
 *
 * Both go through `submitDialogAction`'s endpoint override (D11), so the shared
 * 409-recovery flow, error alerts and dashboard refresh still apply.
 */
type RestartChoice = 'keep' | 'fresh';

export function RestartAgentDialog({
  action,
  actions,
  onClose,
}: {
  action: IssueActionEntry;
  actions: UseIssueActionsResult;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<RestartChoice>('keep');
  const live = hasLiveAgent(actions.state);
  const pending = actions.isActionPending(action.key);

  const submit = () => {
    if (choice === 'fresh') {
      actions.submitDialogAction(action, { spawn: true }, null, '/api/agents/:agentId/restart-fresh');
    } else if (live) {
      actions.submitDialogAction(action, { graceful: true }, null, '/api/agents/:agentId/restart');
    } else {
      actions.submitDialogAction(action, {}, null, '/api/agents/:agentId/recover');
    }
    onClose();
  };

  return (
    <ActionDialogFrame label={action.label} onClose={onClose}>
      <div className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="sr-only">How to restart the agent</legend>
          <Option
            checked={choice === 'keep'}
            onSelect={() => setChoice('keep')}
            title="Keep its memory"
            detail={live
              ? 'Stops the running agent and starts it again with the conversation it already has.'
              : 'Brings the stopped agent back with the conversation it already has.'}
          />
          <Option
            checked={choice === 'fresh'}
            onSelect={() => setChoice('fresh')}
            title="Fresh session"
            detail="The workspace, branch, plan and tasks stay. The agent's saved conversation is discarded."
          />
        </fieldset>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="restart-agent-confirm"
            disabled={pending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            onClick={submit}
          >
            {pending ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      </div>
    </ActionDialogFrame>
  );
}

function Option({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer gap-2 rounded-md border border-border px-3 py-2 hover:bg-accent">
      <input
        type="radio"
        name="restart-agent-choice"
        className="mt-0.5"
        checked={checked}
        onChange={onSelect}
      />
      <span className="min-w-0">
        <span className="block text-xs text-foreground">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
