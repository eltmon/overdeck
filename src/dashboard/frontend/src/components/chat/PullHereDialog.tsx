/**
 * Pull here (PAN-4650 WI-14, FR-4, mockup flows c, d, e, k, m).
 *
 * `openPullHereDialog(conv)` opens the dialog; one host is mounted at the app
 * root. While the owner runs a turn the operator chooses **Wait for this
 * turn** or **Stop it now**; otherwise one **Pull here**. The dialog then
 * starts the pull job, shows its four steps with the current one live, and
 * opens the new conversation when it is done. A failure says the
 * conversation is still running on the owner. **Continue here** in the
 * offline banner runs the same job (its offline path).
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ArrowDownToLine, Check, Circle, Loader2, Square, X } from 'lucide-react';

import { getPull, PULL_POLL_MS, PULL_STEPS, startPull, type PullStatus, type PullStep } from './pullApi';

export interface PullTarget {
  /** The linked name, `@<environmentId>/<ownerName>`. */
  name: string;
  title: string;
  machineLabel: string;
  isWorking: boolean;
  /** The offline banner's Continue here starts the job at once (the vault path). */
  offline?: boolean;
}

interface PullHereStore {
  target: PullTarget | null;
  open: (target: PullTarget) => void;
  close: () => void;
}

export const usePullHereStore = create<PullHereStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export function openPullHereDialog(target: PullTarget): void {
  usePullHereStore.getState().open(target);
}

/** Open a conversation the way /conv/<id> deep links do (client-side route). */
function openConversation(id: number): void {
  window.history.pushState(null, '', `/conv/${id}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function stepLabel(step: PullStep, owner: string): string {
  switch (step) {
    case 'release': return `${owner} settles the conversation and its changes`;
    case 'transfer': return 'Transfer through the secure channel';
    case 'adopt': return 'Adopt on this machine and resume';
    case 'finish': return `${owner} shows “Continued on this machine”`;
  }
}

export function PullHereDialogHost() {
  const target = usePullHereStore((s) => s.target);
  const close = usePullHereStore((s) => s.close);
  if (!target) return null;
  return <PullHereDialog key={target.name} target={target} onClose={close} />;
}

export function PullHereDialog({ target, onClose }: { target: PullTarget; onClose: () => void }) {
  const [pullId, setPullId] = useState<string | null>(null);
  const [status, setStatus] = useState<PullStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (when: 'wait' | 'stop') => {
    setError(null);
    try {
      setPullId(await startPull(target.name, when));
      setStatus({ step: 'release', state: 'running' });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (target.offline) void start('wait');
    // Started once per dialog; the target is fixed for its lifetime (keyed host).
  }, []);

  useEffect(() => {
    if (!pullId || status?.state !== 'running') return undefined;
    const timer = setTimeout(() => {
      getPull(pullId).then(setStatus, (err: Error) => setError(err.message));
    }, PULL_POLL_MS);
    return () => clearTimeout(timer);
  }, [pullId, status]);

  useEffect(() => {
    if (status?.state === 'done' && status.conversation) {
      onClose();
      openConversation(status.conversation.id);
    }
  }, [status, onClose]);

  const owner = target.machineLabel;
  const failed = status?.state === 'failed';
  // A poll failed while the pull runs (e.g. the dashboard restarted and forgot the job): stop
  // the spinner trap, say so, and let the operator close the dialog.
  const lost = status?.state === 'running' && error !== null;
  const closable = !status || failed || lost;
  const current = status ? PULL_STEPS.indexOf(status.step) : -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/32 backdrop-blur-sm" onClick={closable ? onClose : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={status ? 'Pulling here' : 'Pull here'}
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <ArrowDownToLine className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="flex-1 text-sm font-medium">{status ? `Pulling “${target.title}” here` : `Pull “${target.title}” here?`}</h2>
          {closable && (
            <button type="button" aria-label="Close" className="rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:bg-accent" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="space-y-3 px-5 py-4 text-[13px]">
          {status ? (
            <>
              <ol className="space-y-2" data-testid="pull-steps">
                {PULL_STEPS.map((step, index) => {
                  const done = status.state === 'done' || index < current;
                  const live = !done && !failed && index === current;
                  return (
                    <li key={step} className={`flex items-center gap-2 ${done || live ? 'text-foreground' : 'text-muted-foreground'}`} data-step={step} data-live={live || undefined}>
                      {done ? <Check size={13} /> : live ? <Loader2 size={13} className="animate-spin" /> : <Circle size={13} />}
                      {stepLabel(step, owner)}
                    </li>
                  );
                })}
              </ol>
              {failed ? (
                <p role="alert" className="text-destructive">
                  {status.error ?? 'The pull failed'}. The conversation is still running on <span className="font-mono">{owner}</span>.
                </p>
              ) : lost ? (
                <p role="alert" className="text-destructive">
                  Lost track of the pull: {error}. It may still finish; the conversation list shows where it runs.
                </p>
              ) : (
                <p className="text-muted-foreground">If adoption fails, {owner} takes the conversation back and nothing is lost.</p>
              )}
            </>
          ) : (
            <>
              <p>This machine becomes the owner. <span className="font-mono">{owner}</span> stops running the conversation and shows it as “Continued on this machine”, read-only.</p>
              <p>Uncommitted and unpushed changes come with it.</p>
              {target.isWorking && (
                <p><span className="font-mono">{owner}</span> is running a turn right now. Wait for it to finish, or stop it now and pull what is there.</p>
              )}
              <p className="text-muted-foreground">A conversation runs on one machine at a time.</p>
              {error && <p role="alert" className="text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="rounded-[var(--radius-sm)] border border-border px-3 py-1 hover:bg-accent" onClick={onClose}>Cancel</button>
                {target.isWorking ? (
                  <>
                    <button type="button" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-3 py-1 hover:bg-accent" onClick={() => void start('stop')}>
                      <Square size={12} />Stop it now
                    </button>
                    <button type="button" className="rounded-[var(--radius-sm)] bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90" onClick={() => void start('wait')}>
                      Wait for this turn
                    </button>
                  </>
                ) : (
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90" onClick={() => void start('wait')}>
                    <ArrowDownToLine size={12} />Pull here
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
