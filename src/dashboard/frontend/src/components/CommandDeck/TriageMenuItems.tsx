import { useState } from 'react';
import { AlarmClock, CheckCircle2, CircleDashed } from 'lucide-react';
import { MenuItemButton, MenuOverlay, MenuSurface } from '../shared/ContextMenu';
import { formatSnoozeWake, snoozePresets } from './conversation-triage';

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
 * PAN-4639 WI-7/WI-8: Settle/Unsettle and the Snooze submenu (presets, a
 * custom time, Unsnooze), shared by the row's overflow menu and the
 * tab/header action menu so both offer the same items.
 */
export function TriageMenuItems({ conversation, mutations, onClose }: TriageMenuItemsProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const title = conversation.title ?? conversation.name;
  const settled = Boolean(conversation.settledAt);

  const snoozedUntilMs = conversation.snoozedUntil ? Date.parse(conversation.snoozedUntil) : NaN;
  const isCurrentlySnoozed = !Number.isNaN(snoozedUntilMs) && snoozedUntilMs > Date.now();

  const toggleSettle = () => {
    mutations.triage({
      updates: [{ name: conversation.name, settled: !settled }],
      label: settled ? `Moved "${title}" to Inbox` : `Settled "${title}"`,
    });
    onClose();
  };

  const snoozeUntil = (until: Date) => {
    mutations.triage({
      updates: [{ name: conversation.name, snoozedUntil: until.toISOString() }],
      label: `Snoozed "${title}" until ${formatSnoozeWake(until.toISOString(), new Date())}`,
    });
    setSnoozeOpen(false);
    setCustomValue('');
    onClose();
  };

  const unsnooze = () => {
    mutations.triage({ updates: [{ name: conversation.name, snoozedUntil: null }], label: `Unsnoozed "${title}"` });
    onClose();
  };

  const customDate = customValue ? new Date(customValue) : null;
  const customValid = customDate !== null && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now();

  return (
    <>
      <MenuItemButton onClick={toggleSettle}>
        {settled ? <CircleDashed size={14} /> : <CheckCircle2 size={14} />}
        {settled ? 'Unsettle' : 'Settle'}
      </MenuItemButton>
      <span style={{ position: 'relative', display: 'block' }}>
        <MenuItemButton
          aria-haspopup="menu"
          aria-expanded={snoozeOpen}
          onClick={() => setSnoozeOpen((open) => !open)}
        >
          <AlarmClock size={14} />
          Snooze
        </MenuItemButton>
        {snoozeOpen && (
          <>
            <MenuOverlay onClick={() => setSnoozeOpen(false)} />
            <MenuSurface
              aria-label="Snooze conversation"
              onClose={() => setSnoozeOpen(false)}
              className="absolute left-full top-0 z-[1001] ml-1 min-w-[200px]"
            >
              {snoozePresets(new Date()).map((preset) => (
                <MenuItemButton key={preset.id} onClick={() => snoozeUntil(preset.until)}>
                  {preset.label}
                </MenuItemButton>
              ))}
              <div style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="datetime-local"
                  value={customValue}
                  aria-label="Custom snooze time"
                  onChange={(e) => setCustomValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  disabled={!customValid}
                  onClick={() => customDate && snoozeUntil(customDate)}
                >
                  Snooze
                </button>
              </div>
            </MenuSurface>
          </>
        )}
      </span>
      {isCurrentlySnoozed && (
        <MenuItemButton onClick={unsnooze}>
          <AlarmClock size={14} />
          Unsnooze
        </MenuItemButton>
      )}
    </>
  );
}
