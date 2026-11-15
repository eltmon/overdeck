// The composer's toolbar inside the input box (PAN-5295 D2-10): model, effort,
// delivery, compact, attach, voice, context meter and send. ComposerFooter
// owns every value and handler; this component only lays the controls out.

import type { Dispatch, SetStateAction } from 'react';
import { AlertCircle, Loader2, Mic, MicOff, Paperclip, Scissors, SendHorizontal } from 'lucide-react';
import type { HarnessSteerKind } from '@overdeck/contracts';
import { ModelPicker, MODEL_EFFORT_SUPPORT } from './ModelPicker';
import { pickerEffortLevels, type Harness } from '../shared/ModelPicker';
import { EffortPicker } from './EffortPicker';
import { SendModeMenu, type DeliverAs } from './SendModeMenu';
import { ContextWindowMeter } from './ContextWindowMeter';
import type { ComposerEffort } from './useComposerEffort';
import type { ContextWindowSnapshot } from '../../lib/contextWindow';
import type { Conversation } from '../CommandDeck/ConversationList';
import styles from '../CommandDeck/styles/command-deck.module.css';

/** PAN-5295 D2-13: why a started conversation's model button cannot change the model. */
const AGENT_MODEL_LOCKED = "An agent's model is fixed when it starts.";
const CONVERSATION_MODEL_LOCKED = 'The model is fixed once a conversation starts. To use another model, hand off to a new conversation (⋯ → Hand off).';

export interface ComposerToolbarProps {
  conversation: Conversation;
  agentId?: string;
  native: boolean;
  isDisabled: boolean;
  canEditModelBeforeStart: boolean;
  model: string;
  harness: Harness;
  onModelChange: (modelId: string, effortLevels: readonly string[]) => void;
  onComboChange: (modelId: string, effortLevels: readonly string[], harness: Harness) => void;
  onHarnessChange: (harness: Harness) => void;
  contextWindowUsage: ContextWindowSnapshot | null;
  effort: ComposerEffort;
  showDeliverySelector: boolean;
  deliverAs: DeliverAs;
  setDeliverAs: (value: DeliverAs) => void;
  steerKind: HarnessSteerKind;
  scheduleSupported: boolean;
  piConversation: boolean;
  compactPending: boolean;
  onCompact: () => void;
  onAttach: () => void;
  isVoiceWidgetOpen: boolean;
  setIsVoiceWidgetOpen: Dispatch<SetStateAction<boolean>>;
  voiceState: { isListening: boolean; error: string | null };
  sendDisabled: boolean;
  onSend: () => void;
}

export function ComposerToolbar({
  conversation,
  agentId,
  native,
  isDisabled,
  canEditModelBeforeStart,
  model,
  harness,
  onModelChange,
  onComboChange,
  onHarnessChange,
  contextWindowUsage,
  effort,
  showDeliverySelector,
  deliverAs,
  setDeliverAs,
  steerKind,
  scheduleSupported,
  piConversation,
  compactPending,
  onCompact,
  onAttach,
  isVoiceWidgetOpen,
  setIsVoiceWidgetOpen,
  voiceState,
  sendDisabled,
  onSend,
}: ComposerToolbarProps) {
  return (
    <div className={styles.composerToolbar}>
      {!native && (
        <ModelPicker
          value={model}
          onChange={onModelChange}
          onComboChange={onComboChange}
          disabled={isDisabled}
          lockedReason={canEditModelBeforeStart ? undefined : agentId ? AGENT_MODEL_LOCKED : CONVERSATION_MODEL_LOCKED}
          harness={harness}
          onHarnessChange={onHarnessChange}
          liveConversation={conversation.sessionAlive}
        />
      )}
      {/*
        Model drift indicator. The picker holds the model that the
        *next* message will be sent with; if the running session's last
        assistant turn used a different model (e.g. the user ran /model
        inside Claude Code, or Cloister auto-routed), surface it here so
        the picker doesn't silently lie about what's actually running.
      */}
      {contextWindowUsage?.lastModel && contextWindowUsage.lastModel !== model && (
        <span
          className={styles.composerToolbarModelDrift}
          title={`Last assistant turn ran as ${contextWindowUsage.lastModel}; the picker value applies to the next message you send.`}
          data-testid="composer-model-drift"
        >
          running: {contextWindowUsage.lastModel}
        </span>
      )}
      <div className={styles.composerToolbarDivider} />
      <EffortPicker chip={effort.chip} pending={effort.pending} title={effort.title} value={effort.effort} onChange={effort.onChange} disabled={effort.pending || !effort.liveChangeEnabled} availableLevels={pickerEffortLevels(model) ?? MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]} />

      {showDeliverySelector && (
        <SendModeMenu value={deliverAs} onChange={setDeliverAs} steerKind={steerKind} sessionAlive={conversation.sessionAlive} scheduleAvailable={scheduleSupported && !agentId} />
      )}
      {piConversation && !agentId && (
        <>
          <button
            className={styles.voiceToolbarButton}
            onClick={onCompact}
            disabled={!conversation.sessionAlive || compactPending}
            type="button"
            title="Compact context"
            aria-label="Compact context"
          >
            {compactPending ? <Loader2 size={16} className={styles.spinner} /> : <Scissors size={16} />}
          </button>
        </>
      )}

      <div className={styles.composerToolbarSpacer} />

      <button
        className={styles.voiceToolbarButton}
        onClick={onAttach}
        disabled={isDisabled}
        type="button"
        title="Attach files"
        aria-label="Attach files"
      >
        <Paperclip size={16} />
      </button>

      {!native && (
        <button
          className={isVoiceWidgetOpen ? styles.voiceToolbarButtonActive : styles.voiceToolbarButton}
          onClick={() => setIsVoiceWidgetOpen((open) => !open)}
          disabled={isDisabled}
          type="button"
          title={voiceState.error ? `Voice error: ${voiceState.error}` : voiceState.isListening ? 'Voice input listening' : 'Toggle voice input (Ctrl+Shift+M)'}
        >
          {voiceState.error ? <AlertCircle size={16} /> : voiceState.isListening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
      )}

      <ContextWindowMeter usage={contextWindowUsage} />

      <button
        className={styles.sendButton}
        onClick={onSend}
        disabled={sendDisabled}
        type="button"
        title="Send message (Enter)"
      >
        <SendHorizontal size={16} />
      </button>
    </div>
  );
}
