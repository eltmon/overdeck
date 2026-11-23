/**
 * PAN-5604 — announce agent and conversation pending input (AUQ, proposed
 * plans) as a toast + desktop notification, keyed by subject so each
 * notification fires exactly once per key. Extracted from
 * usePendingInputDialogs.ts (#1102): clicking the toast or desktop
 * notification re-opens the dialog for that subject (focus + un-dismiss), not
 * just the window. When a key leaves the live set its notification is
 * dismissed (FR-5).
 */
import { useEffect, useRef } from 'react';
import type { AgentSnapshot } from '@overdeck/contracts';
import type { AskUserQuestionSubject } from '../../components/AskUserQuestionDialog';
import type { PlanApprovalSubject } from '../../components/PlanApprovalDialog';
import type { TerminalPendingPermission } from '../../components/TerminalPermissionDialog';
import { dismissPendingInputNotification, showPendingInputNotification } from './usePermissionNotifications';

export type ConvAskUserQuestionRow = {
  name: string;
  title?: string | null;
  issueId?: string | null;
  /** PAN-3766 — pi ask modals are answered by keystrokes, not a message. */
  harness?: string | null;
  pendingAskUserQuestion?: AskUserQuestionSubject['pendingAskUserQuestion'];
  // PAN-1520 (FR-2) — pending ExitPlanMode plan payload for conversation rows.
  pendingProposedPlan?: PlanApprovalSubject['pendingProposedPlan'];
  // PAN-4278 — a Claude Code terminal permission prompt blocking the conversation.
  pendingPermission?: TerminalPendingPermission;
};

export function usePendingInputAnnouncements(args: {
  agentsWithAskUserQuestion: AgentSnapshot[];
  agentsWithProposedPlan: AgentSnapshot[];
  convRows: ConvAskUserQuestionRow[];
  issueTitleById: Record<string, string | undefined>;
  onOpen: (subjectId: string) => void;
}): void {
  const { agentsWithAskUserQuestion, agentsWithProposedPlan, convRows, issueTitleById, onOpen } = args;
  const notifiedPendingInputRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // #1102 — clicking the toast or desktop notification re-opens the dialog
    // for that subject (focus + un-dismiss), not just focuses the window.
    const announce = (id: string, subjectId: string, title: string, body: string): void => {
      const key = id;
      if (notifiedPendingInputRef.current.has(key)) return;
      notifiedPendingInputRef.current.add(key);
      showPendingInputNotification(key, title, body, () => onOpen(subjectId));
    };

    for (const a of agentsWithAskUserQuestion) {
      const toolUseId = a.pendingAskUserQuestion?.toolUseId;
      if (!toolUseId) continue;
      const body = a.pendingAskUserQuestion?.questions?.[0]?.question ?? 'AskUserQuestion is open.';
      const label = (a.issueId ? issueTitleById[a.issueId] : undefined) ?? a.issueId ?? a.id;
      announce(`agent::${a.id}::${toolUseId}`, a.id, `${label} is waiting on you`, body);
    }
    for (const c of convRows) {
      const toolUseId = c.pendingAskUserQuestion?.toolUseId;
      if (!toolUseId) continue;
      const body = c.pendingAskUserQuestion?.questions?.[0]?.question ?? 'AskUserQuestion is open.';
      const label = c.title ?? c.name;
      announce(`conv::${c.name}::${toolUseId}`, c.name, `"${label}" is waiting on you`, body);
    }

    // PAN-1520 (FR-5) — pending plans fire the same toast + desktop
    // notification; clicking re-opens the PLAN dialog (the reopen effect
    // routes by what's pending, so plan subjects land on PlanApprovalDialog).
    for (const p of agentsWithProposedPlan) {
      const toolUseId = p.pendingProposedPlan?.toolUseId;
      if (!toolUseId) continue;
      const label = (p.issueId ? issueTitleById[p.issueId] : undefined) ?? p.issueId ?? p.id;
      announce(`agent-plan::${p.id}::${toolUseId}`, p.id, `${label} has a plan awaiting approval`, 'Review and approve the plan to start implementation.');
    }
    for (const c of convRows) {
      const toolUseId = c.pendingProposedPlan?.toolUseId;
      if (!toolUseId) continue;
      const label = c.title ?? c.name;
      announce(`conv-plan::${c.name}::${toolUseId}`, c.name, `"${label}" has a plan awaiting approval`, 'Review and approve the plan to start implementation.');
    }

    const liveKeys = new Set<string>();
    for (const a of agentsWithAskUserQuestion) {
      const id = a.pendingAskUserQuestion?.toolUseId;
      if (id) liveKeys.add(`agent::${a.id}::${id}`);
    }
    for (const c of convRows) {
      const id = c.pendingAskUserQuestion?.toolUseId;
      if (id) liveKeys.add(`conv::${c.name}::${id}`);
      const planId = c.pendingProposedPlan?.toolUseId;
      if (planId) liveKeys.add(`conv-plan::${c.name}::${planId}`);
    }
    for (const p of agentsWithProposedPlan) {
      const id = p.pendingProposedPlan?.toolUseId;
      if (id) liveKeys.add(`agent-plan::${p.id}::${id}`);
    }
    for (const k of notifiedPendingInputRef.current) {
      if (liveKeys.has(k)) continue;
      notifiedPendingInputRef.current.delete(k);
      dismissPendingInputNotification(k);
    }
  }, [agentsWithAskUserQuestion, agentsWithProposedPlan, convRows, issueTitleById, onOpen]);
}
