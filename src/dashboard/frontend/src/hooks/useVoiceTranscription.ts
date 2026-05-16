import { useCallback, useEffect, useRef, useState } from 'react';

type VoiceMessage =
  | { type: 'transcript:partial'; text: string }
  | { type: 'transcript:committed'; text: string }
  | { type: 'error'; error: string };

const MAX_SOCKET_BUFFERED_AUDIO_BYTES = 250_000;

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function useVoiceTranscription({ onCommitted }: { onCommitted?: (text: string) => void } = {}) {
  const [partialText, setPartialText] = useState('');
  const [committedText, setCommittedText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const stop = useCallback(() => {
    setIsListening(false);
    socketRef.current?.close();
    socketRef.current = null;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    void audioContextRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
    setAnalyserNode(null);
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    if (isListening) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const socket = new WebSocket(websocketUrl('/ws/voice'));
      socket.binaryType = 'arraybuffer';

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as VoiceMessage;
        if (message.type === 'transcript:partial') setPartialText(message.text);
        if (message.type === 'transcript:committed') {
          setPartialText('');
          setCommittedText((existing) => [existing, message.text].filter(Boolean).join(' '));
          onCommitted?.(message.text);
        }
        if (message.type === 'error') setError(message.error);
      };
      socket.onerror = () => setError('Voice connection failed');
      socket.onclose = () => {
        if (socketRef.current === socket) stop();
      };

      processor.onaudioprocess = (event) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > MAX_SOCKET_BUFFERED_AUDIO_BYTES) return;
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
          pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        socket.send(pcm.buffer);
      };

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(audioContext.destination);

      socketRef.current = socket;
      mediaStreamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      analyserRef.current = analyser;
      processorRef.current = processor;
      setAnalyserNode(analyser);
      setIsListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start voice input');
      stop();
    }
  }, [isListening, onCommitted, stop]);

  const resetTranscript = useCallback(() => {
    setPartialText('');
    setCommittedText('');
  }, []);

  useEffect(() => stop, [stop]);

  return { start, stop, partialText, committedText, isListening, error, analyserNode, resetTranscript };
}
