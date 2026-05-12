import { Mic, MicOff, Send, Square, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Conversation } from '../CommandDeck/ConversationList';
import styles from '../CommandDeck/styles/command-deck.module.css';

type VoiceMode = 'edit' | 'direct';

export function VoiceWidget({
  conversation,
  onInsert,
  onSendDirect,
}: {
  conversation: Conversation;
  onInsert: (text: string) => void;
  onSendDirect: (text: string) => void;
}) {
  const [mode, setMode] = useState<VoiceMode>('edit');
  const [listening, setListening] = useState(false);
  const [partialText, setPartialText] = useState('');
  const [committedText, setCommittedText] = useState('');

  const stop = useCallback(() => {
    setListening(false);
    const text = (committedText || partialText).trim();
    if (!text) return;
    if (mode === 'direct') {
      onSendDirect(text);
      setCommittedText('');
      setPartialText('');
    } else {
      onInsert(text);
    }
  }, [committedText, mode, onInsert, onSendDirect, partialText]);

  const cancel = useCallback(() => {
    setListening(false);
    setPartialText('');
    setCommittedText('');
  }, []);

  return (
    <div className={styles.voiceWidget} data-testid="voice-widget">
      <div className={styles.voiceWidgetHeader}>
        <div>
          <div className={styles.voiceWidgetTitle}>Voice input</div>
          <div className={styles.voiceWidgetMeta}>{conversation.name}</div>
        </div>
        <div className={styles.voiceModeToggle} role="group" aria-label="Voice send mode">
          <button
            type="button"
            className={mode === 'edit' ? styles.voiceModeActive : styles.voiceModeButton}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className={mode === 'direct' ? styles.voiceModeActive : styles.voiceModeButton}
            onClick={() => setMode('direct')}
          >
            Direct
          </button>
        </div>
      </div>

      <div className={styles.voiceWaveform} aria-hidden="true">
        {Array.from({ length: 24 }, (_, index) => (
          <span key={index} className={listening ? styles.voiceWaveBarActive : styles.voiceWaveBar} />
        ))}
      </div>

      <textarea
        className={styles.voiceTranscriptPreview}
        value={partialText || committedText}
        onChange={(event) => {
          setPartialText(event.target.value);
          setCommittedText(event.target.value);
        }}
        placeholder="Live transcript preview will appear here…"
      />

      <div className={styles.voiceWidgetActions}>
        <button
          type="button"
          className={listening ? styles.voiceStopButton : styles.voiceStartButton}
          onClick={() => setListening((value) => !value)}
        >
          {listening ? <MicOff size={14} /> : <Mic size={14} />}
          {listening ? 'Listening' : 'Start'}
        </button>
        <button type="button" className={styles.voiceSecondaryButton} onClick={stop}>
          <Square size={14} /> Stop
        </button>
        <button type="button" className={styles.voiceSecondaryButton} onClick={cancel}>
          <X size={14} /> Cancel
        </button>
        <button type="button" className={styles.voiceSendButton} onClick={stop}>
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  );
}
