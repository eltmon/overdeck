import { useCallback, useEffect, useRef, useState } from 'react';

export type AutoPresoMode = 'staging' | 'live';
export type WarmupStatus = 'idle' | 'warming' | 'ready' | 'failed';
export type ExcalidrawElementLike = Record<string, unknown>;

export interface TranscriptTurn {
  text: string;
  timestamp: Date;
}

type AutoPresoMessage =
  | { type: 'whiteboard:snapshot'; mode?: AutoPresoMode; elements?: ExcalidrawElementLike[]; warmupStatus?: WarmupStatus }
  | { type: 'whiteboard:update'; elements: ExcalidrawElementLike[]; mode?: AutoPresoMode; warmupStatus?: WarmupStatus };

type VoiceMessage =
  | { type: 'transcript:partial'; text: string }
  | { type: 'transcript:committed'; text: string }
  | { type: 'transcript:finalized' };

const MAX_SOCKET_BUFFERED_AUDIO_BYTES = 250_000;
const VOICE_STOP_TIMEOUT_MS = 1000;
const MAX_COMMITTED_TURNS = 200;

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function useAutoPresoWebSocket() {
  const [elements, setElements] = useState<readonly ExcalidrawElementLike[]>([]);
  const [mode, setMode] = useState<AutoPresoMode>('staging');
  const [warmupStatus, setWarmupStatus] = useState<WarmupStatus>('idle');
  const [partialText, setPartialText] = useState('');
  const [committedTurns, setCommittedTurns] = useState<TranscriptTurn[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const whiteboardSocketRef = useRef<WebSocket | null>(null);
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const finalizeResolverRef = useRef<(() => void) | null>(null);

  const connectWhiteboard = useCallback(() => {
    whiteboardSocketRef.current?.close();
    const socket = new WebSocket(websocketUrl('/ws/autopreso'));
    whiteboardSocketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as AutoPresoMessage;
      if (message.type === 'whiteboard:snapshot' || message.type === 'whiteboard:update') {
        if (message.elements) setElements(message.elements);
        if (message.mode) setMode(message.mode);
        if (message.warmupStatus) setWarmupStatus(message.warmupStatus);
      }
    };
    socket.onclose = () => {
      if (!shouldReconnectRef.current || whiteboardSocketRef.current !== socket) return;
      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(connectWhiteboard, delay);
    };
  }, []);

  const closeVoiceResources = useCallback((closeSocket: boolean) => {
    setIsListening(false);
    if (closeSocket) voiceSocketRef.current?.close();
    if (closeSocket) voiceSocketRef.current = null;
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

  const stopListening = useCallback(async (finalize = true) => {
    const socket = voiceSocketRef.current;
    closeVoiceResources(false);
    if (finalize && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop' }));
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, VOICE_STOP_TIMEOUT_MS);
        finalizeResolverRef.current = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
      finalizeResolverRef.current = null;
    }
    closeVoiceResources(true);
  }, [closeVoiceResources]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connectWhiteboard();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      const socket = whiteboardSocketRef.current;
      whiteboardSocketRef.current = null;
      socket?.close();
      void stopListening(false);
    };
  }, [connectWhiteboard, stopListening]);

  const startListening = useCallback(async () => {
    if (isListening) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioContextCtor = window.AudioContext;
    const audioContext = new AudioContextCtor({ sampleRate: 24000 });
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
        setCommittedTurns((turns) => [...turns, { text: message.text, timestamp: new Date() }].slice(-MAX_COMMITTED_TURNS));
      }
      if (message.type === 'transcript:finalized') finalizeResolverRef.current?.();
    };
    socket.onclose = () => {
      if (voiceSocketRef.current === socket) void stopListening(false);
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

    mediaStreamRef.current = stream;
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    analyserRef.current = analyser;
    processorRef.current = processor;
    voiceSocketRef.current = socket;
    setAnalyserNode(analyser);
    setIsListening(true);
  }, [isListening, stopListening]);

  return {
    elements,
    mode,
    warmupStatus,
    partialText,
    committedTurns,
    isListening,
    startListening,
    stopListening,
    analyserNode,
  };
}
