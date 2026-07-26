/**
 * useConversationPaneChoice — PAN-3113. This conversation's blocking pane
 * choice menu (session-resume gate et al.) from the shared pending-input
 * feed (same query key as the decisions surfaces, so no extra poll), plus
 * the mount-local record of choices answered from the dashboard so the
 * timeline keeps an emerald "Answered" row after the feed stops reporting
 * the menu.
 *
 * Conversations only: agent sessions surface pending input through the
 * enrichment pipeline instead, so the hook returns null choice for them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchConversationPendingInput } from './useDecisions';
import type { AnsweredPaneChoice, PendingPaneChoice } from './paneChoice';

export interface ConversationPaneChoiceState {
  livePaneChoice: PendingPaneChoice | null;
  answeredPaneChoices: AnsweredPaneChoice[];
  handlePaneChoiceAnswered: (signature: string, label: string) => void;
}

export function useConversationPaneChoice(
  conversationName: string,
  agentId?: string,
): ConversationPaneChoiceState {
  const { data: pendingInputRows } = useQuery({
    queryKey: ['conv-ask-user-question'],
    queryFn: ({ signal }) => fetchConversationPendingInput(signal),
    refetchInterval: 5000,
  });

  const livePaneChoice = useMemo(() => {
    if (agentId) return null;
    const rows = Array.isArray(pendingInputRows) ? pendingInputRows : [];
    return rows.find((row) => row.name === conversationName)?.pendingPaneChoice ?? null;
  }, [agentId, pendingInputRows, conversationName]);

  const [answeredPaneChoices, setAnsweredPaneChoices] = useState<AnsweredPaneChoice[]>([]);
  useEffect(() => {
    setAnsweredPaneChoices([]);
  }, [conversationName]);

  const handlePaneChoiceAnswered = useCallback((signature: string, label: string) => {
    setAnsweredPaneChoices((prev) => [
      ...prev.filter((a) => a.signature !== signature),
      { signature, label, at: new Date().toISOString() },
    ]);
  }, []);

  return { livePaneChoice, answeredPaneChoices, handlePaneChoiceAnswered };
}
