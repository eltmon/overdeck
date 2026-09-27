/**
 * PAN-4278 — state for TerminalPermissionDialog, fed by the conversation
 * pending-input feed rows (`pendingPermission`).
 *
 * The dialog never hides a prompt optimistically: after a successful answer it
 * stays open in "Confirming…" until a later poll stops reporting that
 * signature. Dismiss and "Open terminal" hide one prompt (signature, or agent
 * key for a prompt that is not on screen) for this browser session — the
 * escape from a stale hook entry.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  TerminalPendingPermission,
  TerminalPermissionChoice,
  TerminalPermissionSubject,
} from '../../components/TerminalPermissionDialog';
import { navigateToDecisionSubject } from '../../lib/navigateToDecision';
import { respondToTerminalPermission } from '../api';

export interface TerminalPermissionFeedRow {
  name: string;
  title?: string | null;
  pendingPermission?: TerminalPendingPermission;
}

/** Identity of one pending permission for dismissal, confirmation and notification. */
export function terminalPermissionKey(name: string, permission: TerminalPendingPermission): string {
  return `${name}::${permission.signature ?? `unanswerable:${permission.agentKey ?? 'unknown'}`}`;
}

export function useTerminalPermissionDialog(rows: TerminalPermissionFeedRow[], blocked: boolean) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const subjects: TerminalPermissionSubject[] = rows
    .filter((row): row is TerminalPermissionFeedRow & { pendingPermission: TerminalPendingPermission } => row.pendingPermission != null)
    .map((row) => ({ conversationName: row.name, title: row.title ?? null, pendingPermission: row.pendingPermission }))
    .filter((subject) => !dismissed.has(terminalPermissionKey(subject.conversationName, subject.pendingPermission)))
    .sort((a, b) => a.pendingPermission.since.localeCompare(b.pendingPermission.since));
  const subject =
    subjects.find((s) => terminalPermissionKey(s.conversationName, s.pendingPermission) === confirmingKey)
    ?? subjects[0]
    ?? null;
  const liveKeys = subjects.map((s) => terminalPermissionKey(s.conversationName, s.pendingPermission)).join('\n');

  // "Confirming…" ends only when the feed stops reporting the answered prompt.
  useEffect(() => {
    if (confirmingKey && !liveKeys.split('\n').includes(confirmingKey)) setConfirmingKey(null);
  }, [confirmingKey, liveKeys]);

  const refetchFeed = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['conv-ask-user-question'] }),
    [queryClient],
  );

  const onAnswer = useCallback(async (choice: TerminalPermissionChoice) => {
    const signature = subject?.pendingPermission.signature;
    if (!subject || !signature) return;
    setIsSubmitting(true);
    try {
      const result = await respondToTerminalPermission(subject.conversationName, signature, choice);
      if (result.ok) {
        setConfirmingKey(terminalPermissionKey(subject.conversationName, subject.pendingPermission));
      } else if (result.code === 'delivery-unconfirmed') {
        toast.warning('The keys were sent but the prompt is still up — answer it in the terminal');
      } else if (result.code === 'prompt-changed' || result.code === 'prompt-gone') {
        toast.info('The permission prompt changed — review it again');
      } else {
        toast.error(result.error ?? `Failed to answer the permission prompt (${result.status})`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to answer the permission prompt');
    } finally {
      setIsSubmitting(false);
      void refetchFeed();
    }
  }, [refetchFeed, subject]);

  const dismiss = useCallback(() => {
    if (!subject) return;
    const key = terminalPermissionKey(subject.conversationName, subject.pendingPermission);
    setDismissed((prev) => new Set(prev).add(key));
  }, [subject]);

  const onOpenTerminal = useCallback(() => {
    if (!subject) return;
    // The modal would cover the terminal it just opened, so hide this prompt too.
    dismiss();
    navigateToDecisionSubject({ id: subject.conversationName, source: 'conversation' });
  }, [dismiss, subject]);

  return {
    subject,
    isOpen: subject !== null && !blocked,
    isSubmitting,
    confirming: subject !== null && confirmingKey === terminalPermissionKey(subject.conversationName, subject.pendingPermission),
    onAnswer: (choice: TerminalPermissionChoice) => { void onAnswer(choice); },
    onOpenTerminal,
    onDismiss: dismiss,
  };
}
