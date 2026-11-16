/**
 * PAN-4278 — Claude Code terminal permission prompt, answered from the
 * dashboard. The server parses the prompt off the conversation's pane
 * (`pendingPermission` on the pending-input feed); this dialog shows who asked
 * and for what, and sends the choice as arrows + Enter through
 * POST /api/conversations/:id/permission. A prompt that is not on screen
 * (`answerable: false`, only the hook saw it) offers "Open terminal" instead.
 */
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

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
    <Modal
      title="Permission needed"
      description="Claude Code is waiting for a permission answer before it can continue."
      onClose={onDismiss}
      dismissible={!busy}
      tone="warning"
      footer={
        <>
          <button type="button" onClick={onDismiss} disabled={busy} className={formStyles.button}>
            Dismiss
          </button>
          <button type="button" onClick={onOpenTerminal} className={permission.answerable ? formStyles.button : formStyles.primaryButton}>
            Open terminal
          </button>
          {permission.answerable && permission.options.map((option) => (
            <button
              key={option.choice}
              type="button"
              onClick={() => onAnswer(option.choice)}
              disabled={busy}
              title={option.label}
              className={option.choice === 'deny' ? formStyles.button : formStyles.primaryButton}
            >
              {CHOICE_LABELS[option.choice]}
            </button>
          ))}
        </>
      }
    >
      <div className={`${formStyles.content} flex flex-col gap-4`}>
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
          <p className={formStyles.hint}>
            The top of this prompt is scrolled off the agent&apos;s screen; the visible part is shown.
          </p>
        )}

        {!permission.answerable && (
          <p className={formStyles.hint}>
            This prompt can&apos;t be answered from here — open the terminal and answer it there.
          </p>
        )}
        {confirming && (
          <p className={formStyles.status}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Confirming…
          </p>
        )}
      </div>
    </Modal>
  );
}
