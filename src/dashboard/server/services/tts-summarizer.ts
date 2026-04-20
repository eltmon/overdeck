/**
 * TTS Summarizer Service
 *
 * Batches recent activity.entry events and sends them to a cheap model
 * (default: gpt-5.4-nano) to produce concise, natural-language TTS utterances.
 *
 * - Off by default — enabled via tts.summarizer.enabled in ~/.panopticon/config.yaml
 * - Configurable model and batch window
 * - Emits activity.tts events that pan-tts consumes
 */

import { loadConfig } from '../../../lib/config-yaml.js';
import { getEventStore, type StoredEvent } from '../event-store.js';
import { emitActivityTts } from '../../../lib/activity-logger.js';

interface SummarizerState {
  timer: ReturnType<typeof setInterval> | null;
  unsubscribe: (() => void) | null;
  buffer: ActivityItem[];
  lastFlush: number;
}

interface ActivityItem {
  source: string;
  level: string;
  message: string;
  issueId?: string;
  timestamp: string;
}

interface OpenAIChatCompletion {
  choices: Array<{
    message: { content: string };
  }>;
}

const SYSTEM_PROMPT = `You are a concise voice narrator for a software development dashboard.
Your job: review recent activity and produce a SINGLE brief utterance suitable for text-to-speech.

Rules:
- MAXIMUM 120 characters. Shorter is better.
- Speak in present tense, like a calm assistant giving a quick update.
- Mention issue IDs naturally (e.g. "PAN-123" not "Issue P-A-N dash 1-2-3").
- If multiple things happened, synthesize into one coherent sentence — don't list them.
- Skip trivial or redundant details. Focus on meaningful state changes.
- Never output bullet points, quotes, or formatting. Just plain spoken text.
- If there's nothing noteworthy, reply with exactly: <silence>

Examples:
Input: "PAN-456 review passed", "PAN-456 tests running"
Output: "PAN-456 passed review and tests are now running."

Input: "PAN-789 merged to main", "Dashboard started in development mode"
Output: "PAN-789 has been merged to main."

Input: "PAN-123 verification failed: lint errors"
Output: "PAN-123 verification failed due to lint errors."

Input: "Agent idle", "Agent idle"
Output: <silence>`;

const state: SummarizerState = {
  timer: null,
  unsubscribe: null,
  buffer: [],
  lastFlush: 0,
};

async function callSummarizer(
  model: string,
  apiKey: string,
  items: ActivityItem[],
): Promise<string | null> {
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Recent activity:\n${items.map(i => `- ${i.message}`).join('\n')}`,
      },
    ],
    temperature: 0.4,
    max_tokens: 80,
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      console.warn(`[tts-summarizer] OpenAI error ${res.status}: ${errText}`);
      return null;
    }

    const data = (await res.json()) as OpenAIChatCompletion;
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text || text === '<silence>') return null;
    return text;
  } catch (err) {
    console.warn('[tts-summarizer] API call failed:', err);
    return null;
  }
}

async function flush(): Promise<void> {
  const { config } = loadConfig();
  if (!config.ttsSummarizer.enabled) return;

  const items = state.buffer.splice(0);
  if (items.length === 0) return;

  const apiKey = config.apiKeys.openai;
  if (!apiKey) {
    console.warn('[tts-summarizer] OpenAI API key not configured; skipping summary');
    return;
  }

  const utterance = await callSummarizer(config.ttsSummarizer.model, apiKey, items);
  if (!utterance) return;

  const hasError = items.some(i => i.level === 'error');
  const hasWarn = items.some(i => i.level === 'warn');
  const priority = hasError ? 0 : hasWarn ? 1 : 2;

  try {
    emitActivityTts({ utterance, priority });
  } catch {
  }

  state.lastFlush = Date.now();
}

function onEvent(event: StoredEvent): void {
  if (event.type !== 'activity.entry') return;

  const payload = event.payload as Record<string, unknown>;
  const item: ActivityItem = {
    source: String(payload.source ?? 'unknown'),
    level: String(payload.level ?? 'info'),
    message: String(payload.message ?? ''),
    issueId: payload.issueId ? String(payload.issueId) : undefined,
    timestamp: event.timestamp,
  };

  if (!item.message) return;

  state.buffer.push(item);

  if (state.buffer.length > 50) {
    state.buffer.splice(0, state.buffer.length - 50);
  }
}

export function startTtsSummarizer(): void {
  if (state.timer !== null) return;

  const { config } = loadConfig();
  if (!config.ttsSummarizer.enabled) {
    console.log('[tts-summarizer] Disabled (tts.summarizer.enabled=false)');
    return;
  }

  const store = getEventStore();
  state.unsubscribe = store.subscribe(onEvent);

  const intervalMs = config.ttsSummarizer.batchWindowSeconds * 1000;
  state.timer = setInterval(() => {
    flush().catch(() => {
    });
  }, intervalMs);

  console.log(
    `[tts-summarizer] Started (model=${config.ttsSummarizer.model}, window=${config.ttsSummarizer.batchWindowSeconds}s)`,
  );
}

export function stopTtsSummarizer(): void {
  if (state.timer !== null) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  state.buffer = [];
}
