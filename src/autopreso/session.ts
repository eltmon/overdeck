import { runWhiteboardAgent, runWhiteboardWarmupOnce, type AutoPresoAgentSettings } from './agent.js';
import { normalizeElements, type ExcalidrawElement } from './whiteboard-elements.js';
import { extractKeywordsFromElements } from './whiteboard-keywords.js';

export type AutoPresoMode = 'staging' | 'live';
export type WarmupStatus = 'idle' | 'warming' | 'ready' | 'failed';
export type ExcalidrawElementLike = Partial<ExcalidrawElement>;
export type AutoPresoAgentMessage = { role: 'user' | 'assistant'; content: string };

interface AutoPresoSnapshot {
  mode: AutoPresoMode;
  warmupStatus: WarmupStatus;
  elements: readonly ExcalidrawElement[];
  agentHistory: readonly AutoPresoAgentMessage[];
  canvasDirtyForAgent: boolean;
}

type AutoPresoListener = (snapshot: AutoPresoSnapshot) => void;

type QueuedTranscript = {
  transcripts: string[];
  byteLength: number;
  settings: AutoPresoAgentSettings;
};

export type ProcessTranscriptResult = {
  accepted: boolean;
  coalesced: boolean;
  snapshot: AutoPresoSnapshot;
};

export interface AutoPresoSession {
  mode: AutoPresoMode;
  warmupStatus: WarmupStatus;
  elements: ExcalidrawElement[];
  agentHistory: AutoPresoAgentMessage[];
  canvasDirtyForAgent: boolean;
  snapshot(): AutoPresoSnapshot;
  start(elements: readonly ExcalidrawElementLike[], settings: AutoPresoAgentSettings): AutoPresoSnapshot;
  backToStaging(): AutoPresoSnapshot;
  reset(): AutoPresoSnapshot;
  processTranscript(transcript: string, settings: AutoPresoAgentSettings): ProcessTranscriptResult;
  subscribe(listener: AutoPresoListener): () => void;
}

const MAX_WARMUP_ATTEMPTS = 8;
const INITIAL_WARMUP_BACKOFF_MS = 2000;
const MAX_WARMUP_BACKOFF_MS = 30000;
const MAX_PENDING_TRANSCRIPT_BYTES = 16_384;
const MAX_PENDING_TRANSCRIPT_TURNS = 8;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function createWarmupUserMessage(elements: readonly ExcalidrawElementLike[]): AutoPresoAgentMessage {
  const normalizedElements = normalizeElements(elements);
  const keywords = extractKeywordsFromElements(normalizedElements);
  return {
    role: 'user',
    content: JSON.stringify({ type: 'warmup', keywords, elements: normalizedElements }),
  };
}

export function createWhiteboardSession(): AutoPresoSession {
  const listeners = new Set<AutoPresoListener>();
  let warmupGeneration = 0;
  let warmupAbortController: AbortController | null = null;
  let activeTranscriptRun: Promise<void> | null = null;
  let pendingTranscript: QueuedTranscript | null = null;

  const session: AutoPresoSession = {
    mode: 'staging',
    warmupStatus: 'idle',
    elements: [],
    agentHistory: [],
    canvasDirtyForAgent: false,
    snapshot() {
      return {
        mode: session.mode,
        warmupStatus: session.warmupStatus,
        elements: session.elements,
        agentHistory: session.agentHistory,
        canvasDirtyForAgent: session.canvasDirtyForAgent,
      };
    },
    start(nextElements, settings) {
      warmupAbortController?.abort();
      const abortController = new AbortController();
      warmupAbortController = abortController;
      const generation = ++warmupGeneration;
      const warmupUserMessage = createWarmupUserMessage(nextElements);
      session.mode = 'live';
      session.warmupStatus = 'warming';
      session.elements = normalizeElements(nextElements);
      session.agentHistory = [];
      session.canvasDirtyForAgent = true;
      activeTranscriptRun = null;
      pendingTranscript = null;
      const current = notify();
      void runWarmupLoop(generation, warmupUserMessage, settings, abortController.signal);
      return current;
    },
    backToStaging() {
      warmupAbortController?.abort();
      warmupAbortController = null;
      warmupGeneration += 1;
      session.mode = 'staging';
      session.warmupStatus = 'idle';
      session.canvasDirtyForAgent = false;
      pendingTranscript = null;
      return notify();
    },
    reset() {
      warmupAbortController?.abort();
      warmupAbortController = null;
      warmupGeneration += 1;
      session.mode = 'staging';
      session.warmupStatus = 'idle';
      session.elements = [];
      session.agentHistory = [];
      session.canvasDirtyForAgent = false;
      pendingTranscript = null;
      return notify();
    },
    processTranscript(transcript, settings) {
      if (session.mode !== 'live') {
        return { accepted: false, coalesced: false, snapshot: session.snapshot() };
      }
      const encodedLength = Buffer.byteLength(transcript, 'utf8');
      const nextTurnCount = (pendingTranscript?.transcripts.length ?? 0) + 1;
      const nextByteLength = (pendingTranscript?.byteLength ?? 0) + encodedLength;
      if (nextTurnCount > MAX_PENDING_TRANSCRIPT_TURNS || nextByteLength > MAX_PENDING_TRANSCRIPT_BYTES) {
        return { accepted: false, coalesced: activeTranscriptRun !== null, snapshot: session.snapshot() };
      }
      const coalesced = activeTranscriptRun !== null;
      pendingTranscript = pendingTranscript
        ? { transcripts: [...pendingTranscript.transcripts, transcript], byteLength: nextByteLength, settings }
        : { transcripts: [transcript], byteLength: encodedLength, settings };
      runNextTranscript(warmupGeneration);
      return { accepted: true, coalesced, snapshot: session.snapshot() };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const notify = () => {
    const current = session.snapshot();
    for (const listener of listeners) listener(current);
    return current;
  };

  const runNextTranscript = (generation: number): void => {
    if (activeTranscriptRun || !pendingTranscript) return;
    const next = pendingTranscript;
    pendingTranscript = null;
    activeTranscriptRun = (async () => {
      if (generation !== warmupGeneration || session.mode !== 'live') return;
      await runWhiteboardAgent(next.transcripts.join('\n'), session, next.settings, {
        isCurrent: () => generation === warmupGeneration && session.mode === 'live',
      });
      if (generation !== warmupGeneration || session.mode !== 'live') return;
      notify();
    })().catch((error) => {
      console.error('[AutoPreso] Transcript processing failed:', error);
    }).finally(() => {
      activeTranscriptRun = null;
      if (generation === warmupGeneration && session.mode === 'live') runNextTranscript(generation);
    });
  };

  const runWarmupLoop = async (
    generation: number,
    warmupUserMessage: AutoPresoAgentMessage,
    settings: AutoPresoAgentSettings,
    signal: AbortSignal
  ): Promise<void> => {
    for (let attempt = 0; attempt < MAX_WARMUP_ATTEMPTS; attempt += 1) {
      if (signal.aborted) return;
      try {
        await runWhiteboardWarmupOnce(session, settings, signal);
        if (signal.aborted || generation !== warmupGeneration) return;
        session.agentHistory = [warmupUserMessage, { role: 'assistant', content: 'UNDERSTOOD' }];
        session.warmupStatus = 'ready';
        session.canvasDirtyForAgent = false;
        if (warmupAbortController?.signal === signal) warmupAbortController = null;
        notify();
        return;
      } catch {
        if (signal.aborted || generation !== warmupGeneration) return;
        if (attempt === MAX_WARMUP_ATTEMPTS - 1) {
          session.warmupStatus = 'failed';
          if (warmupAbortController?.signal === signal) warmupAbortController = null;
          notify();
          return;
        }
        const backoff = Math.min(
          INITIAL_WARMUP_BACKOFF_MS * 2 ** attempt,
          MAX_WARMUP_BACKOFF_MS
        );
        await sleep(backoff, signal);
        if (signal.aborted || generation !== warmupGeneration) return;
      }
    }
  };

  return session;
}

export const autoPresoSession = createWhiteboardSession();
