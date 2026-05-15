import { Mic, MicOff, Send, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceTranscription } from '../../hooks/useVoiceTranscription';
import type { Conversation } from '../CommandDeck/ConversationList';
import styles from '../CommandDeck/styles/command-deck.module.css';

type VoiceMode = 'edit' | 'direct';

export function VoiceWidget({
  conversation,
  onInsert,
  onSendDirect,
  onStateChange,
}: {
  conversation: Conversation;
  onInsert: (text: string) => void;
  onSendDirect: (text: string) => void;
  onStateChange?: (state: { isListening: boolean; error: string | null }) => void;
}) {
  const [mode, setMode] = useState<VoiceMode>('edit');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const directModeRef = useRef(mode);
  const { start, stop, partialText, committedText, isListening, error, analyserNode, resetTranscript } = useVoiceTranscription({
    onCommitted: (text) => {
      if (directModeRef.current === 'direct') onSendDirect(text);
    },
  });
  const previewText = partialText || committedText;

  useEffect(() => {
    directModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    onStateChange?.({ isListening, error });
    return () => onStateChange?.({ isListening: false, error: null });
  }, [error, isListening, onStateChange]);

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices?.().then((items) => {
      setDevices(items.filter((item) => item.kind === 'audioinput'));
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = analyserNode;
    if (!canvas || !analyser || !isListening) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const draw = () => {
      frame = window.requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = 'hsl(210 100% 62%)';
      context.lineWidth = 2;
      context.beginPath();
      data.forEach((value, index) => {
        const x = (index / Math.max(1, data.length - 1)) * canvas.width;
        const y = (value / 255) * canvas.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };
    draw();
    return () => window.cancelAnimationFrame(frame);
  }, [analyserNode, isListening]);

  const stopAndApply = useCallback(() => {
    stop();
    const text = committedText.trim();
    if (mode === 'edit' && text) onInsert(text);
    resetTranscript();
  }, [committedText, mode, onInsert, resetTranscript, stop]);

  const cancel = useCallback(() => {
    stop();
    resetTranscript();
  }, [resetTranscript, stop]);

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

      <div className={styles.voiceWidgetControls}>
        <label className={styles.voiceFieldLabel}>
          Mic
          <select className={styles.voiceSelect} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">Default microphone</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
            ))}
          </select>
        </label>
        <label className={styles.voiceFieldLabel}>
          Model
          <select className={styles.voiceSelect} defaultValue="base">
            <option value="tiny">tiny</option>
            <option value="base">base</option>
          </select>
        </label>
      </div>

      <canvas ref={canvasRef} className={styles.voiceWaveformCanvas} width={480} height={56} aria-label="Voice waveform" />

      <textarea
        className={styles.voiceTranscriptPreview}
        value={previewText}
        readOnly
        placeholder={error ? `Voice error: ${error}` : 'Live transcript preview will appear here…'}
      />

      <div className={styles.voiceWidgetActions}>
        <button
          type="button"
          className={isListening ? styles.voiceStopButton : styles.voiceStartButton}
          onClick={() => (isListening ? stopAndApply() : void start(deviceId || undefined))}
        >
          {isListening ? <MicOff size={14} /> : <Mic size={14} />}
          {isListening ? 'Listening' : 'Start'}
        </button>
        <button type="button" className={styles.voiceSecondaryButton} onClick={stopAndApply}>
          <Square size={14} /> Stop
        </button>
        <button type="button" className={styles.voiceSecondaryButton} onClick={cancel}>
          <X size={14} /> Cancel
        </button>
        <button type="button" className={styles.voiceSendButton} onClick={stopAndApply}>
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  );
}
