import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { AutoPresoSession } from './session.js';
import { normalizeElements, type ExcalidrawElement } from './whiteboard-elements.js';
import { applyWhiteboardEditOperations, formatLineNumberedWhiteboard, type Op } from './whiteboard-tools.js';

export interface AutoPresoAgentSettings {
  autopreso: {
    provider: 'openai' | 'codex' | 'ollama';
    model: string;
  };
}

const DEFAULT_SETTINGS: AutoPresoAgentSettings = {
  autopreso: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
};

type WhiteboardApplyInput = {
  ops: Op[];
  viewport?: { x: number; y: number; zoom: number };
};

type WhiteboardOverwriteInput = {
  elements: Partial<ExcalidrawElement>[];
};

async function readCodexBearerToken(): Promise<string> {
  const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8');
  const parsed = JSON.parse(raw) as { bearer?: string; accessToken?: string; token?: string };
  const token = parsed.bearer ?? parsed.accessToken ?? parsed.token;
  if (!token) throw new Error('Codex auth token not found in ~/.codex/auth.json');
  return token;
}

async function createModel(settings: AutoPresoAgentSettings) {
  const { provider, model } = settings.autopreso;
  if (provider === 'openai') {
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
  }
  if (provider === 'codex') {
    const baseURL = process.env.AUTOPRESO_CODEX_BASE_URL;
    if (!baseURL) throw new Error('AUTOPRESO_CODEX_BASE_URL must be set to use the Codex AutoPreso provider');
    return createOpenAI({ apiKey: await readCodexBearerToken(), baseURL })(model);
  }
  return createOpenAI({ apiKey: 'ollama', baseURL: 'http://localhost:11434/v1' })(model);
}

function createTools(session: AutoPresoSession) {
  return {
    whiteboard_apply: {
      description: 'Apply line-numbered edits to the current Excalidraw whiteboard.',
      inputSchema: {
        type: 'object',
        properties: {
          ops: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['replace', 'insert_after', 'delete'] },
                lineNumber: { type: 'number' },
                element: { type: 'object', additionalProperties: true },
              },
              required: ['action', 'lineNumber'],
              additionalProperties: false,
            },
          },
          viewport: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              zoom: { type: 'number' },
            },
            required: ['x', 'y', 'zoom'],
            additionalProperties: false,
          },
        },
        required: ['ops'],
        additionalProperties: false,
      },
      execute: async (input: WhiteboardApplyInput) => {
        session.elements = applyWhiteboardEditOperations(session.elements, input.ops);
        session.canvasDirtyForAgent = false;
        return { elements: session.elements, viewport: input.viewport ?? null };
      },
    },
    whiteboard_overwrite: {
      description: 'Replace the entire Excalidraw whiteboard with normalized elements.',
      inputSchema: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
        },
        required: ['elements'],
        additionalProperties: false,
      },
      execute: async (input: WhiteboardOverwriteInput) => {
        session.elements = normalizeElements(input.elements);
        session.canvasDirtyForAgent = false;
        return { elements: session.elements };
      },
    },
  };
}

function systemPrompt(session: AutoPresoSession): string {
  return [
    'You update an Excalidraw whiteboard from spoken transcript turns.',
    'Use whiteboard_apply for incremental edits and whiteboard_overwrite only when a full reset is necessary.',
    'Current whiteboard:',
    formatLineNumberedWhiteboard(normalizeElements(session.elements)),
  ].join('\n');
}

export async function runWhiteboardAgent(
  transcript: string,
  session: AutoPresoSession,
  settings: AutoPresoAgentSettings = DEFAULT_SETTINGS
): Promise<ExcalidrawElement[]> {
  const model = await createModel(settings);
  await generateText({
    model,
    system: systemPrompt(session),
    prompt: transcript,
    tools: createTools(session) as never,
  });
  session.elements = normalizeElements(session.elements);
  return session.elements;
}

export async function runWhiteboardWarmupOnce(
  session: AutoPresoSession,
  settings: AutoPresoAgentSettings = DEFAULT_SETTINGS,
  signal?: AbortSignal
): Promise<void> {
  const model = await createModel(settings);
  await generateText({
    model,
    system: systemPrompt(session),
    prompt: 'Warm up for low-latency whiteboard editing. Reply with UNDERSTOOD.',
    abortSignal: signal,
  });
}
