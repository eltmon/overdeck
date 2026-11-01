import { CheckCircle2, CircleDashed } from 'lucide-react';
import { MenuItemButton } from '../shared/ContextMenu';

interface TriageMenuItemsProps {
  conversation: { name: string; title?: string | null; settledAt?: string | null; snoozedUntil?: string | null };
  /** The `triage` mutation from useConversationMutations (typed structurally
   *  so this file adds no import cycle through it). */
  mutations: {
    triage: (opts: { updates: Array<{ name: string; settled?: boolean; snoozedUntil?: string | null }>; label: string }) => void;
  };
  onClose: () => void;
}

/**
 * PAN-4639 WI-7: Settle/Unsettle, shared by the row's overflow menu and the
 * tab/header action menu so both offer the same items.
 */
export function TriageMenuItems({ conversation, mutations, onClose }: TriageMenuItemsProps) {
  const title = conversation.title ?? conversation.name;
  const settled = Boolean(conversation.settledAt);

  const toggleSettle = () => {
    mutations.triage({
      updates: [{ name: conversation.name, settled: !settled }],
      label: settled ? `Moved "${title}" to Inbox` : `Settled "${title}"`,
    });
    onClose();
  };

  return (
    <MenuItemButton onClick={toggleSettle}>
      {settled ? <CircleDashed size={14} /> : <CheckCircle2 size={14} />}
      {settled ? 'Unsettle' : 'Settle'}
    </MenuItemButton>
  );
}
