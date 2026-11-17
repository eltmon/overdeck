/**
 * Settings → Computer Use (PAN-5461 WI-6a): one card that sets up desktop control
 * on the host in one click (D-1), turns it on and off, and lets the operator take
 * the desktop back from an agent. Every status describes the machine running
 * Overdeck, never the device the browser is on. Data: useComputerUseStatus.
 */
import type { ReactNode } from 'react';
import { Check, Circle, Copy, Loader2, MousePointerClick, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useComputerUseStatus,
  type ComputerUseSetupStepReport,
  type ComputerUseStatusView,
} from '../hooks/useComputerUseStatus';
import { ComputerUseMacPermissions } from './ComputerUseMacPermissions';

type Tone = 'neutral' | 'success' | 'warning' | 'info';

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'bg-muted border-border text-muted-foreground',
  success: 'bg-success/8 border-success/32 text-success-foreground',
  warning: 'bg-warning/8 border-warning/32 text-warning-foreground',
  info: 'bg-info/8 border-info/32 text-info-foreground',
};

const CHECK_TONE: Record<ComputerUseStatusView['checks'][number]['status'], string> = {
  ok: 'text-muted-foreground',
  action: 'text-warning-foreground',
  missing: 'text-destructive-foreground',
  unavailable: 'text-destructive-foreground',
};

const PRIMARY_CTA =
  'inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed';
const SECONDARY_BUTTON =
  'rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed';

function Badge({ tone, children, testId }: { tone: Tone; children: string; testId: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Allow agents to use the desktop"
      data-testid="computer-use-enabled-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
        checked ? 'switch-track-on border-transparent' : 'border-border bg-muted'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-3 w-3 rounded-full shadow-sm transition-transform ${
          checked ? 'translate-x-[15px] bg-background' : 'translate-x-[2px] bg-muted-foreground'
        }`}
      />
    </button>
  );
}

const PROVIDER_STEP_IDS = new Set(['install-packages', 'enable-accessibility', 'grant-permissions']);

function providerSteps(status: ComputerUseStatusView) {
  return status.setupSteps.filter((step) => PROVIDER_STEP_IDS.has(step.id));
}

const MAC_OFF_COPY =
  'Setup installs the Overdeck Computer Use helper and opens two macOS permission pages. Switch on Overdeck Computer Use in each, then press Continue.';
const MAC_PERMISSION_IDS = ['accessibility', 'screen-recording'];

function offDescription(status: ComputerUseStatusView): string {
  if (status.platform === 'darwin' && providerSteps(status).length > 0) return MAC_OFF_COPY;
  // WSL2 drives Windows through built-in PowerShell and UI Automation (PAN-5462 FR-6).
  if (status.platform === 'wsl') return 'Nothing to install: Windows already includes what it needs. One click turns it on.';
  const parts: string[] = [];
  for (const step of providerSteps(status)) {
    if (step.id === 'install-packages') parts.push(`installs ${step.label.replace(/^Install /, '')}`);
    else if (step.id === 'enable-accessibility') parts.push('turns on GNOME accessibility');
    else parts.push(step.label.charAt(0).toLowerCase() + step.label.slice(1));
  }
  if (parts.length === 0) return 'Everything it needs is already installed. One click turns it on.';
  return `Setup ${parts.join(', ')} and tests everything.`;
}

function StepIcon({ status }: { status: ComputerUseSetupStepReport['status'] | 'running' | 'pending' }) {
  if (status === 'running') return <Loader2 aria-label="Running" className="h-3.5 w-3.5 animate-spin text-info-foreground" />;
  if (status === 'pending') return <Circle aria-label="Pending" className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === 'done') return <Check aria-label="Done" className="h-3.5 w-3.5 text-success" />;
  if (status === 'failed') return <X aria-label="Failed" className="h-3.5 w-3.5 text-destructive-foreground" />;
  return <Circle aria-label={status === 'waiting' ? 'Waiting' : 'Skipped'} className="h-3.5 w-3.5 text-muted-foreground" />;
}

const STEP_TEXT: Record<ComputerUseSetupStepReport['status'], string> = {
  done: 'text-foreground',
  skipped: 'text-muted-foreground',
  failed: 'text-destructive-foreground',
  waiting: 'text-warning-foreground',
};

function RunningSteps({ status }: { status: ComputerUseStatusView }) {
  return (
    <ul data-testid="computer-use-setup-steps" className="mt-3 space-y-1.5">
      {status.setupSteps.map((step, index) => (
        <li key={step.id} className="flex items-center gap-2 text-xs text-foreground">
          <StepIcon status={index === 0 ? 'running' : 'pending'} />
          {step.label}
        </li>
      ))}
    </ul>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <code data-testid="computer-use-command" className="flex-1 break-all font-mono text-xs text-foreground">
        {command}
      </code>
      <button
        type="button"
        data-testid="computer-use-copy-command"
        aria-label="Copy command"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(
            () => toast('Copied.'),
            () => toast.error('Could not copy the command.'),
          );
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FinishedSteps({ steps }: { steps: ComputerUseSetupStepReport[] }) {
  return (
    <ul data-testid="computer-use-setup-steps" className="mt-3 space-y-2">
      {steps.map((step) => (
        <li key={step.id} className="text-xs">
          <div className={`flex items-center gap-2 ${STEP_TEXT[step.status]}`}>
            <StepIcon status={step.status} />
            {step.label}
          </div>
          {step.message ? (
            <p className={`mt-1 pl-6 ${step.status === 'waiting' ? 'text-warning-foreground' : 'text-muted-foreground'}`}>{step.message}</p>
          ) : null}
          {step.command ? <div className="pl-6"><CommandBlock command={step.command} /></div> : null}
        </li>
      ))}
    </ul>
  );
}

function ChecksList({ status }: { status: ComputerUseStatusView }) {
  return (
    <details data-testid="computer-use-checks" className="mt-4 border-t border-border pt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What Overdeck checked</summary>
      <ul className="mt-2 space-y-1.5">
        {status.checks.map((check) => (
          <li key={check.id}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">{check.label}</span>
              <span className={`text-right ${CHECK_TONE[check.status]}`}>{check.detail}</span>
            </div>
            {check.fixCommand ? <code className="block font-mono text-muted-foreground">{check.fixCommand}</code> : null}
          </li>
        ))}
        <li className="text-muted-foreground" data-testid="computer-use-skill">
          {status.skill.installed
            ? `pan-computer-use skill — installed in ${status.skill.locations.join(', ')}`
            : 'pan-computer-use skill — not installed. Run pan sync.'}
        </li>
      </ul>
    </details>
  );
}

function EnableRow({ busy, setEnabled }: { busy: boolean; setEnabled: (enabled: boolean) => Promise<boolean> }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-foreground">Allow agents to use the desktop</div>
        <div className="text-xs text-muted-foreground">Turning this off stops new actions right away.</div>
      </div>
      <Switch
        checked
        disabled={busy}
        onChange={(next) => {
          void setEnabled(next).then((saved) => {
            if (saved && !next) toast('Computer Use is off. Agents get a "disabled" error.');
          });
        }}
      />
    </div>
  );
}

function leaseSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function ComputerUseSection() {
  const {
    status, loadError, refreshing, refresh, runSetup, settingUp, setupResult, setEnabled, release, openPermission, busy, actionError,
  } = useComputerUseStatus();

  const startSetup = () => {
    void runSetup().then((result) => {
      if (result?.ok) toast.success('Computer Use is ready.');
    });
  };

  const header = (
    <h2 className="text-foreground text-base font-medium tracking-tight mb-2 flex items-center gap-2">
      <MousePointerClick className="w-4 h-4 text-muted-foreground" />
      Computer Use
    </h2>
  );
  const isWsl = status?.platform === 'wsl';
  const lede = (
    <p className="text-xs text-muted-foreground mb-4">
      Lets agents see and operate {isWsl ? 'Windows' : 'desktop'} apps on{' '}
      <span className="font-mono">{status?.hostname ?? 'this host'}</span>{' '}
      {isWsl ? '(the PC running Overdeck in WSL)' : '(the machine running Overdeck)'} when you ask them to: read windows, click,
      type and take screenshots.
    </p>
  );

  if (loadError) {
    return (
      <section id="computer-use" className="py-6 scroll-mt-4">
        {header}
        <div
          data-testid="computer-use-load-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive-foreground"
        >
          {loadError}
        </div>
      </section>
    );
  }

  if (!status) {
    return (
      <section id="computer-use" className="py-6 scroll-mt-4">
        {header}
        {lede}
        <p className="text-xs text-muted-foreground">Checking this machine…</p>
      </section>
    );
  }

  const unavailable = !status.supported || !status.session.ok;
  const lastStep = setupResult?.steps.at(-1);
  const stalled = lastStep && (lastStep.status === 'failed' || lastStep.status === 'waiting') ? lastStep.status : null;
  const allOk = status.checks.every((check) => check.status === 'ok');
  const hasProviderSteps = providerSteps(status).length > 0;
  const needsPassword = status.setupSteps.some((step) => step.needsPassword);
  const isMac = status.platform === 'darwin';
  const macPermissionMissing =
    isMac && MAC_PERMISSION_IDS.some((id) => status.checks.find((check) => check.id === id)?.status !== 'ok');

  let title: string;
  let badge: { tone: Tone; label: string } | null;
  let body: ReactNode;

  if (unavailable) {
    title = 'Not available on this machine';
    badge = { tone: 'neutral', label: 'Unavailable' };
    body = <p className="text-xs text-muted-foreground">{status.session.ok ? '' : status.session.message}</p>;
  } else if (settingUp) {
    title = 'Setting up Computer Use';
    badge = { tone: 'info', label: 'Working' };
    body = (
      <>
        <button type="button" data-testid="computer-use-cta" disabled className={PRIMARY_CTA}>
          Setting up…
        </button>
        <RunningSteps status={status} />
      </>
    );
  } else if (setupResult && stalled) {
    title = stalled === 'waiting' ? 'Setup is waiting for you' : 'Setup stopped';
    badge = { tone: 'warning', label: stalled === 'waiting' ? 'Waiting' : 'Needs attention' };
    body = (
      <>
        <FinishedSteps steps={setupResult.steps} />
        <div className="mt-4">
          <button type="button" data-testid="computer-use-cta" onClick={startSetup} className={PRIMARY_CTA}>
            {stalled === 'waiting' ? 'Continue' : 'Try again'}
          </button>
        </div>
        {/* A failed test-helper leaves the flag on (WI-4b); the operator can still turn it off here. */}
        {status.enabled ? (
          <div className="mt-4">
            <EnableRow busy={busy} setEnabled={setEnabled} />
          </div>
        ) : null}
      </>
    );
  } else if (status.enabled) {
    title = 'Computer Use is on';
    badge = allOk ? { tone: 'success', label: 'Ready' } : { tone: 'warning', label: 'Needs attention' };
    const lease = status.lease;
    body = (
      <>
        <p className="text-xs text-muted-foreground">
          {isWsl
            ? "Agents can operate Windows apps when you ask them to. They can't close apps with Alt+F4, lock Windows or open Task Manager."
            : "Agents can operate desktop apps when you ask them to. They can't quit apps, lock the screen or log you out."}
        </p>
        {macPermissionMissing ? (
          <p data-testid="computer-use-mac-regrant" className="mt-2 text-xs text-warning-foreground">
            macOS asks you to allow the updated helper again.
          </p>
        ) : null}
        {!allOk ? (
          <div className="mt-3">
            <button type="button" data-testid="computer-use-cta" onClick={startSetup} className={PRIMARY_CTA}>
              Fix setup
            </button>
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
          {isMac ? (
            <ComputerUseMacPermissions
              checks={status.checks}
              busy={busy}
              onOpen={(id) => {
                void openPermission(id);
              }}
            />
          ) : null}
          <EnableRow busy={busy} setEnabled={setEnabled} />
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                Desktop control
                {lease ? <Badge tone="info" testId="computer-use-lease-badge">In use</Badge> : <Badge tone="neutral" testId="computer-use-lease-badge">Free</Badge>}
              </div>
              {lease ? (
                <div data-testid="computer-use-lease-holder" className="text-xs text-muted-foreground">
                  {lease.holder} is driving the desktop · its turn ends in {leaseSeconds(lease.expiresAt)}s unless it acts again.
                </div>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="computer-use-release"
              disabled={!lease || busy}
              onClick={() => {
                void release().then((released) => {
                  if (released) toast('Released the desktop.');
                });
              }}
              className={SECONDARY_BUTTON}
            >
              Take back control
            </button>
          </div>
        </div>
      </>
    );
  } else {
    title = 'Computer Use is off';
    badge = { tone: 'neutral', label: 'Off' };
    body = (
      <>
        <p className="text-xs text-muted-foreground">{offDescription(status)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" data-testid="computer-use-cta" onClick={startSetup} className={PRIMARY_CTA}>
            {hasProviderSteps ? 'Set up and turn on' : 'Turn on Computer Use'}
          </button>
          <span data-testid="computer-use-password-note" className="text-xs text-muted-foreground">
            {needsPassword ? 'Your system will ask for your password once, to install packages.' : 'No password needed.'}
          </span>
        </div>
      </>
    );
  }

  return (
    <section id="computer-use" className="py-6 scroll-mt-4">
      {header}
      {lede}
      <div data-testid="computer-use-card" className="rounded-lg border border-border bg-card px-4 py-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span data-testid="computer-use-title" className="text-sm font-medium text-foreground">{title}</span>
            {badge ? <Badge tone={badge.tone} testId="computer-use-badge">{badge.label}</Badge> : null}
          </div>
          <button
            type="button"
            data-testid="computer-use-refresh"
            disabled={refreshing}
            onClick={refresh}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {body}
        {actionError ? (
          <p data-testid="computer-use-action-error" className="mt-3 text-xs text-destructive-foreground">{actionError}</p>
        ) : null}
        <ChecksList status={status} />
      </div>
    </section>
  );
}
