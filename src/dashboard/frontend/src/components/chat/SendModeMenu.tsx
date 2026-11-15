/**
 * The composer's Send menu (PAN-5295 D2-11, parent D-6): how a message reaches
 * a busy agent. It replaces the native delivery `<select>` (PAN-4292, PAN-4641)
 * with a menu button in the picker style; the posted values are unchanged.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { HarnessSteerKind } from '@overdeck/contracts';
import { currentPlatform } from '../../lib/shortcuts/keys';
import { useFloatingPickerPosition } from './useFloatingPickerPosition';
import styles from '../CommandDeck/styles/command-deck.module.css';

export type DeliverAs = 'auto' | 'steer' | 'follow_up' | 'when_limit_resets';

/** PAN-4292 D1: what Steer means for Claude Code. */
const CLAUDE_STEER_TOOLTIP = 'Steer: interrupt the current turn and send now (Claude Code Ctrl+Enter). Auto queues the message for the running turn.';

interface SendMode {
  value: DeliverAs;
  label: string;
  description: string;
  keycap?: string;
  title?: string;
}

interface SendModeMenuProps {
  value: DeliverAs;
  onChange: (value: DeliverAs) => void;
  steerKind: HarnessSteerKind;
  sessionAlive: boolean;
  /** PAN-4641: offer "when the limit resets" (the server holds the message). */
  scheduleAvailable?: boolean;
}

function sendModes(steerKind: HarnessSteerKind, scheduleAvailable: boolean): SendMode[] {
  const modes: SendMode[] = [
    { value: 'auto', label: 'normally', description: 'Delivered the usual way for this agent.' },
    {
      value: 'steer',
      label: 'interrupt now',
      description: 'Stops the current turn and sends now.',
      keycap: currentPlatform() === 'mac' ? '⌘ Enter' : 'Ctrl Enter',
      title: CLAUDE_STEER_TOOLTIP,
    },
  ];
  if (steerKind === 'control-channel') {
    modes.push({ value: 'follow_up', label: 'after this turn', description: 'Waits until the current turn ends.' });
  }
  if (scheduleAvailable) {
    modes.push({ value: 'when_limit_resets', label: 'when the limit resets', description: 'Holds the message on the server until the usage limit resets.' });
  }
  return modes;
}

export function SendModeMenu({ value, onChange, steerKind, sessionAlive, scheduleAvailable = false }: SendModeMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { style: dropdownStyle } = useFloatingPickerPosition(open, ref, dropdownRef, { preferredHeight: 240 });
  const modes = sendModes(steerKind, scheduleAvailable);
  const selected = modes.find((mode) => mode.value === value) ?? modes[0]!;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={styles.pickerContainer}>
      <button
        className={styles.pickerBtn}
        onClick={() => setOpen((o) => !o)}
        disabled={!sessionAlive}
        title="How your message reaches a busy agent"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.pickerLabel}>Send: {selected.label}</span>
        <ChevronDown size={11} />
      </button>

      {open && createPortal(
        <div ref={dropdownRef} role="menu" aria-label="Send" className={styles.pickerDropdown} style={dropdownStyle}>
          <div className="flex w-full flex-col p-1">
            {modes.map((mode) => (
              <button
                key={mode.value}
                role="menuitemradio"
                aria-checked={mode.value === selected.value}
                className={`${styles.pickerOption} flex-col gap-0.5 ${mode.value === selected.value ? styles.pickerOptionActive : ''}`}
                onClick={() => {
                  onChange(mode.value);
                  setOpen(false);
                }}
                title={mode.title}
                type="button"
              >
                <span className="flex w-full items-baseline gap-3">
                  <span className="font-medium">{mode.label}</span>
                  {mode.keycap && <kbd className="ml-auto text-muted-foreground">{mode.keycap}</kbd>}
                </span>
                <span className="block text-muted-foreground">{mode.description}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
