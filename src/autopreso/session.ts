import { runWhiteboardAgent, runWhiteboardWarmupOnce } from './agent.js';
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

export interface AutoPresoSession {
  mode: AutoPresoMode;
  warmupStatus: WarmupStatus;
  elements: ExcalidrawElement[];
  agentHistory: AutoPresoAgentMessage[];
  canvasDirtyForAgent: boolean;
  snapshot(): AutoPresoSnapshot;
  start(elements: readonly ExcalidrawElementLike[]): AutoPresoSnapshot;
  backToStaging(): AutoPresoSnapshot;
  reset(): AutoPresoSnapshot;
  processTranscript(transcript: string): Promise<AutoPresoSnapshot>;
  subscribe(listener: AutoPresoListener): () => void;
}

const MAX_WARMUP_ATTEMPTS = 8;
const INITIAL_WARMUP_BACKOFF_MS = 2000;
const MAX_WARMUP_BACKOFF_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    start(nextElements) {
      const generation = ++warmupGeneration;
      const warmupUserMessage = createWarmupUserMessage(nextElements);
      session.mode = 'live';
      session.warmupStatus = 'warming';
      session.elements = normalizeElements(nextElements);
      session.agentHistory = [];
      session.canvasDirtyForAgent = true;
      const current = notify();
      void runWarmupLoop(generation, warmupUserMessage);
      return current;
    },
    backToStaging() {
      warmupGeneration += 1;
      session.mode = 'staging';
      session.warmupStatus = 'idle';
      session.canvasDirtyForAgent = false;
      return notify();
    },
    reset() {
      warmupGeneration += 1;
      session.mode = 'staging';
      session.warmupStatus = 'idle';
      session.elements = [];
      session.agentHistory = [];
      session.canvasDirtyForAgent = false;
      return notify();
    },
    async processTranscript(transcript) {
      if (session.mode !== 'live') return session.snapshot();
      await runWhiteboardAgent(transcript, session);
      return notify();
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

  const runWarmupLoop = async (
    generation: number,
    warmupUserMessage: AutoPresoAgentMessage
  ): Promise<void> => {
    for (let attempt = 0; attempt < MAX_WARMUP_ATTEMPTS; attempt += 1) {
      try {
        await runWhiteboardWarmupOnce(session);
        if (generation !== warmupGeneration) return;
        session.agentHistory = [warmupUserMessage, { role: 'assistant', content: 'UNDERSTOOD' }];
        session.warmupStatus = 'ready';
        session.canvasDirtyForAgent = false;
        notify();
        return;
      } catch {
        if (generation !== warmupGeneration) return;
        if (attempt === MAX_WARMUP_ATTEMPTS - 1) {
          session.warmupStatus = 'failed';
          notify();
          return;
        }
        const backoff = Math.min(
          INITIAL_WARMUP_BACKOFF_MS * 2 ** attempt,
          MAX_WARMUP_BACKOFF_MS
        );
        await sleep(backoff);
        if (generation !== warmupGeneration) return;
      }
    }
  };

  return session;
}

export const autoPresoSession = createWhiteboardSession();
