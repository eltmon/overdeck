/**
 * The composer's delivery-mode selector (PAN-4292): Auto, Steer, and Pi's
 * Follow-up, plus "When limits reset" (PAN-4641). Extracted from ComposerFooter (PAN-4641 WI-10) to keep that file
 * under the size ceiling; markup and behavior are unchanged.
 */
import type { HarnessSteerKind } from '@overdeck/contracts';
import styles from '../CommandDeck/styles/command-deck.module.css';

export type DeliverAs = 'auto' | 'steer' | 'follow_up' | 'when_limit_resets';

/** PAN-4292 D1: what Steer means for Claude Code, shown on the selector while Steer is chosen. */
const CLAUDE_STEER_TOOLTIP = 'Steer: interrupt the current turn and send now (Claude Code Ctrl+Enter). Auto queues the message for the running turn.';

interface DeliveryModeSelectProps {
  value: DeliverAs;
  onChange: (value: DeliverAs) => void;
  steerKind: HarnessSteerKind;
  agentBusy: boolean;
  sessionAlive: boolean;
  steerOptionLabel: string;
  /** PAN-4641: offer "When limits reset" (queue the message on the server). */
  scheduleAvailable?: boolean;
}

export function DeliveryModeSelect({ value, onChange, steerKind, agentBusy, sessionAlive, steerOptionLabel, scheduleAvailable }: DeliveryModeSelectProps) {
  return (
    <select
      className={styles.deliveryMethodSelect}
      value={value}
      onChange={(event) => onChange(event.target.value as DeliverAs)}
      title={steerKind === 'control-channel'
        ? (agentBusy ? 'Pi delivery mode while busy' : 'Pi delivery mode')
        : (value === 'steer' ? CLAUDE_STEER_TOOLTIP : 'Delivery mode')}
      aria-label={steerKind === 'control-channel' ? 'Pi delivery mode' : 'Delivery mode'}
      disabled={!sessionAlive}
    >
      <option value="auto">Auto</option>
      <option value="steer">{steerOptionLabel}</option>
      {steerKind === 'control-channel' && <option value="follow_up">Follow-up</option>}
      {scheduleAvailable && <option value="when_limit_resets">When limits reset</option>}
    </select>
  );
}
