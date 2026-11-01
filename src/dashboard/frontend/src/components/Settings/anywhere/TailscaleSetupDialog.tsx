/**
 * Settings → Anywhere → Set up Tailscale (PAN-1254 W-14).
 *
 * Walks the same steps as `pan tailscale setup`, one panel per `nextStep`
 * from `GET /api/tailscale/status` (polled every 3 s while open). Commands
 * that may need `sudo` run in a terminal pane (`POST /api/terminals`) where
 * the operator types any password; Overdeck never sees it (NFR-1). Turning on
 * HTTPS access also turns on token sign-in (D-2), and the panel says so
 * before the button. Closing the dialog deletes every pane it created.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { XTerminal } from '../../XTerminal';
import { ANYWHERE_STATUS_QUERY_KEY, apiError, isOk } from './anywhereApi';
import { TailscalePhoneQr } from './TailscalePhoneQr';
import {
  TAILSCALE_STATUS_QUERY_KEY,
  createPane,
  deletePane,
  fetchTailscaleStatus,
  postLogin,
  postServe,
  postUserspace,
  type TailscaleStatusBody,
} from './tailscaleApi';

const PRIMARY_BUTTON = 'rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50';
const SECONDARY_BUTTON = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors';
const ADMIN_DNS_URL = 'https://login.tailscale.com/admin/dns';

interface TailscaleSetupDialogProps {
  open: boolean;
  onClose: () => void;
  /** The ready step's Pair a device: the host closes this dialog and opens the pair dialog. */
  onPair?: () => void;
}

export function TailscaleSetupDialog({ open, onClose, onPair }: TailscaleSetupDialogProps) {
  if (!open) return null;
  return <TailscaleSetupDialogBody onClose={onClose} onPair={onPair} />;
}

function CopyableCommand({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 break-all rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">{command}</code>
      <button type="button" className={SECONDARY_BUTTON} onClick={() => void navigator.clipboard?.writeText(command)}>Copy</button>
    </div>
  );
}

function TailscaleSetupDialogBody({ onClose, onPair }: { onClose: () => void; onPair?: () => void }) {
  const queryClient = useQueryClient();
  const [userspace, setUserspace] = useState(false);
  const { data: result, isLoading } = useQuery({
    queryKey: [...TAILSCALE_STATUS_QUERY_KEY, userspace],
    queryFn: () => fetchTailscaleStatus(userspace),
    refetchInterval: 3000,
  });

  const [pane, setPane] = useState<{ sessionName: string; command: string } | null>(null);
  const [operatorOverride, setOperatorOverride] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState<{ text: string; url?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Every pane this dialog opened, deleted when the dialog closes.
  const panesRef = useRef(new Set<string>());
  useEffect(() => () => {
    for (const sessionName of panesRef.current) void deletePane(sessionName);
  }, []);

  const body = result && isOk(result) ? result.body : null;
  const step = operatorOverride ? 'operator' : body?.state.nextStep;

  // A new step starts clean: no stale message, sign-in link or pane.
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    setMessage(null);
    setPane(null);
    if (step !== 'login') setLoginUrl(undefined);
  }, [step]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: TAILSCALE_STATUS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const openPane = (command: string) => run(async () => {
    const created = await createPane(command);
    if (!isOk(created)) {
      setMessage({ text: apiError(created) });
      return;
    }
    panesRef.current.add(created.body.sessionName);
    setPane({ sessionName: created.body.sessionName, command });
  });

  const signIn = () => run(async () => {
    const login = await postLogin();
    if (login.status === 409 && (login.body as { nextStep?: unknown } | null)?.nextStep === 'operator') {
      setOperatorOverride(true);
      return;
    }
    if (!isOk(login)) {
      setMessage({ text: apiError(login) });
      return;
    }
    setLoginUrl(login.body.authUrl);
    refresh();
  });

  const turnOnServe = () => run(async () => {
    const serve = await postServe();
    const outcome = serve.body as { ok?: boolean; message?: string; adminUrl?: string } | null;
    if (!isOk(serve) || outcome?.ok === false) {
      setMessage({ text: outcome?.message ?? apiError(serve), url: outcome?.adminUrl });
      return;
    }
    refresh();
  });

  const userspaceAction = () => run(async () => {
    const outcome = await postUserspace();
    const value = outcome.body as { ok?: boolean; message?: string } | null;
    if (!isOk(outcome) || value?.ok === false) {
      setMessage({ text: value?.message ?? apiError(outcome) });
      return;
    }
    refresh();
  });

  const paneSection = (command: string, label: string) => (
    pane && pane.command === command ? (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Type your password in the terminal if asked. Overdeck never sees it.</p>
        <div className="h-64 overflow-hidden rounded-md border border-border" data-testid="tailscale-pane">
          <XTerminal sessionName={pane.sessionName} embedded />
        </div>
        <button type="button" className={SECONDARY_BUTTON} onClick={refresh}>Check again</button>
      </div>
    ) : (
      <div className="space-y-2">
        <CopyableCommand command={command} />
        <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void openPane(command)}>{label}</button>
      </div>
    )
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-xl mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tailscale-setup-title"
        data-component="tailscale-setup-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="tailscale-setup-title" className="text-base font-medium text-foreground">Set up Tailscale</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Checking Tailscale…</p>
          ) : !body ? (
            <p className="text-xs text-muted-foreground">Tailscale status is unavailable{result ? `: ${apiError(result)}` : '.'}</p>
          ) : (
            <StepPanel
              step={step!}
              body={body}
              userspace={userspace}
              loginUrl={loginUrl}
              busy={busy}
              paneSection={paneSection}
              onUseUserspace={() => setUserspace(true)}
              onUserspace={() => void userspaceAction()}
              onSignIn={() => void signIn()}
              onRetrySignIn={() => {
                setOperatorOverride(false);
                void signIn();
              }}
              operatorFromLogin={operatorOverride}
              onServe={() => void turnOnServe()}
              onCheck={refresh}
              onPair={onPair}
            />
          )}
          {message && (
            <p className="text-xs text-foreground" role="status">
              {message.text}
              {message.url && (
                <>
                  {' '}
                  <a href={message.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepPanelProps {
  step: TailscaleStatusBody['state']['nextStep'];
  body: TailscaleStatusBody;
  userspace: boolean;
  loginUrl: string | null | undefined;
  busy: boolean;
  paneSection: (command: string, label: string) => React.ReactNode;
  onUseUserspace: () => void;
  onUserspace: () => void;
  onSignIn: () => void;
  onRetrySignIn: () => void;
  operatorFromLogin: boolean;
  onServe: () => void;
  onCheck: () => void;
  onPair?: () => void;
}

function StepPanel(props: StepPanelProps) {
  const { step, body, busy } = props;
  const checkAgain = <button type="button" className={SECONDARY_BUTTON} onClick={props.onCheck}>Check again</button>;

  switch (step) {
    case 'install': {
      const plan = body.install;
      if (plan.kind === 'userspace') {
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Overdeck downloads Tailscale into its own folder and runs it for this user. No administrator password is needed.</p>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={props.onUserspace}>Install for this user</button>
          </div>
        );
      }
      if (plan.kind === 'manual') {
        return (
          <div className="space-y-2">
            <p className="text-xs text-foreground">{plan.message}</p>
            <a href={plan.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{plan.url}</a>
            {plan.command && <CopyableCommand command={plan.command} />}
            {checkAgain}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Tailscale is not installed on this machine.</p>
          {props.paneSection(plan.command, 'Install Tailscale')}
          {body.platform === 'linux' && body.userspaceAvailable && !props.userspace && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={props.onUseUserspace}>
              Install without an administrator password
            </button>
          )}
        </div>
      );
    }
    case 'start-daemon':
      if (body.state.mode === 'userspace') {
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Overdeck&apos;s Tailscale service is not running.</p>
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={props.onUserspace}>Restart Tailscale</button>
          </div>
        );
      }
      if (body.platform === 'linux' && body.state.mode === 'system') {
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">The Tailscale service is installed but not running.</p>
            {props.paneSection('sudo systemctl enable --now tailscaled', 'Start Tailscale')}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Open the Tailscale app, then press Check again.</p>
          {checkAgain}
        </div>
      );
    case 'operator':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Tailscale only lets one user change its settings. Make this user that operator so Overdeck can sign in and turn on HTTPS.
          </p>
          {body.operatorCommand
            ? props.paneSection(body.operatorCommand, 'Make this user the operator')
            : <CopyableCommand command="sudo tailscale set --operator=$USER" />}
          {props.operatorFromLogin && (
            <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={props.onRetrySignIn}>Try signing in again</button>
          )}
        </div>
      );
    case 'login':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Sign this machine in to your tailnet.</p>
          {props.loginUrl ? (
            <>
              <a href={props.loginUrl} target="_blank" rel="noreferrer" className={PRIMARY_BUTTON + ' inline-block'}>Open sign-in</a>
              <p className="text-xs text-muted-foreground">Waiting for sign-in…</p>
            </>
          ) : props.loginUrl === null ? (
            <p className="text-xs text-muted-foreground">Waiting for sign-in…</p>
          ) : (
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={props.onSignIn}>Sign in</button>
          )}
        </div>
      );
    case 'enable-https':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Turn on MagicDNS and HTTPS certificates for your tailnet, then press Check again.</p>
          <a href={ADMIN_DNS_URL} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{ADMIN_DNS_URL}</a>
          <div>{checkAgain}</div>
        </div>
      );
    case 'serve':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This also turns on &apos;Require a token to sign in&apos;. Browsers that already have a session keep working; a new browser, including one at {body.state.serveUrl ?? 'the Serve address'}, must pair.
          </p>
          <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={props.onServe}>Turn on HTTPS access</button>
        </div>
      );
    case 'protect':
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Tailscale Serve already sends tailnet visitors here, but a token is not required to sign in.</p>
          <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={props.onServe}>Protect the dashboard</button>
        </div>
      );
    case 'ready':
      return (
        <div className="space-y-2" data-testid="tailscale-ready">
          <p className="text-xs text-muted-foreground">Other devices on your tailnet can open this dashboard at:</p>
          {body.state.serveUrl && <CopyableCommand command={body.state.serveUrl} />}
          {props.onPair && <TailscalePhoneQr loginName={body.state.loginName} onPair={props.onPair} />}
        </div>
      );
  }
}
