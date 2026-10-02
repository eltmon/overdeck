/**
 * PAN-4278 — Claude Code terminal permission prompt, answered from the
 * dashboard. The server parses the prompt off the conversation's pane
 * (`pendingPermission` on the pending-input feed); this dialog shows who asked
 * and for what, and sends the choice as arrows + Enter through
 * POST /api/conversations/:id/permission. A prompt that is not on screen
 * (`answerable: false`, only the hook saw it) offers "Open terminal" instead.
 */
import type { ReactNode } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

export type TerminalPermissionChoice = 'allow-once' | 'allow-always' | 'deny';

/** Mirror of the server's `PendingPermission` (src/lib/overdeck/conversation-permission.ts). */
export interface TerminalPendingPermission {
  signature: string | null;
  answerable: boolean;
  agentLabel: string;
  agentKey: string | null;
  toolName: string | null;
  header: string | null;
  clipped: boolean;
  inputPreview: string | null;
  detailLines: string[];
  reason: string | null;
  options: Array<{ choice: TerminalPermissionChoice; label: string }>;
  since: string;
}

export interface TerminalPermissionSubject {
  conversationName: string;
  title: string | null;
  pendingPermission: TerminalPendingPermission;
}

interface TerminalPermissionDialogProps {
  subject: TerminalPermissionSubject | null;
  isOpen: boolean;
  isSubmitting?: boolean;
  confirming?: boolean;
  onAnswer: (choice: TerminalPermissionChoice) => void;
  onOpenTerminal: () => void;
  onDismiss: () => void;
}

const CHOICE_LABELS: Record<TerminalPermissionChoice, string> = {
  'allow-once': 'Allow once',
  'allow-always': 'Allow always',
  deny: 'Deny',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

const SECONDARY_BUTTON = 'rounded-md border border-border bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60';
const PRIMARY_BUTTON = 'inline-flex items-center gap-2 rounded-md bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-60';

export function TerminalPermissionDialog({
  subject,
  isOpen,
  isSubmitting = false,
  confirming = false,
  onAnswer,
  onOpenTerminal,
  onDismiss,
}: TerminalPermissionDialogProps) {
  if (!isOpen || !subject) return null;
  const permission = subject.pendingPermission;
  const busy = isSubmitting || confirming;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-label="Permission needed" className="w-full max-w-2xl overflow-hidden rounded-xl border border-warning/30 bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="rounded-full bg-warning/15 p-2">
            <ShieldAlert className="h-5 w-5 text-warning-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Permission needed</h2>
            <p className="text-sm text-muted-foreground">
              Claude Code is waiting for a permission answer before it can continue.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Conversation">
              <p className="text-sm text-foreground">{subject.title ?? subject.conversationName}</p>
            </Field>
            <Field label="Agent">
              <p className="text-sm text-foreground">{permission.agentLabel}</p>
            </Field>
            <Field label="Tool">
              <p className="text-sm font-medium text-foreground">{permission.toolName ?? permission.header ?? 'Unknown tool'}</p>
            </Field>
          </div>

          {permission.clipped && permission.inputPreview && (
            <Field label="Command (start)">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/80 p-3 font-mono text-xs text-foreground">
                {permission.inputPreview}
              </pre>
            </Field>
          )}

          {permission.detailLines.length > 0 && (
            <Field label={permission.clipped ? 'On screen' : 'Command'}>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/80 p-3 font-mono text-xs text-foreground">
                {permission.detailLines.join('\n')}
              </pre>
            </Field>
          )}

          {permission.reason && (
            <Field label="Reason">
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                {permission.reason}
              </div>
            </Field>
          )}

          {permission.clipped && (
            <p className="text-sm text-muted-foreground">
              The top of this prompt is scrolled off the agent&apos;s screen; the visible part is shown.
            </p>
          )}

          {!permission.answerable && (
            <p className="text-sm text-muted-foreground">
              This prompt can&apos;t be answered from here — open the terminal and answer it there.
            </p>
          )}
          {confirming && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming…
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-card/40 px-5 py-4">
          <button type="button" onClick={onDismiss} disabled={busy} className={SECONDARY_BUTTON}>
            Dismiss
          </button>
          <button type="button" onClick={onOpenTerminal} className={permission.answerable ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
            Open terminal
          </button>
          {permission.answerable && permission.options.map((option) => (
            <button
              key={option.choice}
              type="button"
              onClick={() => onAnswer(option.choice)}
              disabled={busy}
              title={option.label}
              className={option.choice === 'deny' ? SECONDARY_BUTTON : PRIMARY_BUTTON}
            >
              {CHOICE_LABELS[option.choice]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
