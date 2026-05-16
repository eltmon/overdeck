import type { ITurnEmitter } from './transcription.js';

const TURN_DEBOUNCE_MS = 150;
const FILLER_WORDS = new Set([
  'ah',
  'eh',
  'er',
  'hmm',
  'hm',
  'mm',
  'okay',
  'ok',
  'uh',
  'um',
  'yeah',
  'yep',
]);

export interface TurnQueue {
  flush(): void;
  close(): void;
}

export function isTrivialTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  return FILLER_WORDS.has(normalized);
}

export function createTurnQueue(
  emitter: ITurnEmitter,
  onTurn: (text: string) => void
): TurnQueue {
  const chunks: string[] = [];
  let timer: NodeJS.Timeout | null = null;

  const flush = () => {
    timer = null;
    const text = chunks.splice(0).join(' ').trim();
    if (text && !isTrivialTranscript(text)) onTurn(text);
  };

  emitter.onCommitted((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    chunks.push(trimmed);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, TURN_DEBOUNCE_MS);
  });

  return {
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    },
    close() {
      if (timer || chunks.length > 0) this.flush();
      timer = null;
      chunks.length = 0;
    },
  };
}
