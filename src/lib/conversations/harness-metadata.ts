/**
 * Harness-specific metadata parsers for discovered sessions (PAN-2224).
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

import type { SessionMetadata } from './jsonl-async.js';

interface PiSessionLine {
  type: 'session';
  id?: string;
  timestamp?: string;
  cwd?: string;
}

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface PiMessageLine {
  type: 'message';
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | PiContentBlock[];
    model?: string;
    usage?: PiUsage;
  };
}

interface PiModelChangeLine {
  type: 'model_change';
  timestamp?: string;
  provider?: string;
  modelId?: string;
  model?: string;
}

interface PiContentBlock {
  type?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

type PiLine = PiSessionLine | PiMessageLine | PiModelChangeLine | Record<string, unknown>;

const FILE_TOOLS = new Set(['read', 'edit', 'write', 'glob', 'notebookedit']);

export async function parsePiSessionMetadata(filePath: string): Promise<SessionMetadata> {
  const result = emptySessionMetadata();
  const modelCounts: Record<string, number> = {};
  const toolsSet = new Set<string>();
  const filesSet = new Set<string>();
  let currentModel: string | null = null;

  await new Promise<void>((resolve) => {
    const readStream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: readStream, crlfDelay: Infinity });
    let finalized = false;

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      try {
        rl.close();
      } catch {
        // ignore
      }
      try {
        readStream.destroy();
      } catch {
        // ignore
      }
      resolve();
    };

    rl.on('line', (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      let parsed: PiLine;
      try {
        parsed = JSON.parse(line) as PiLine;
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.type === 'session') {
        if (!result.sessionId && typeof parsed.id === 'string' && parsed.id.length > 0) {
          result.sessionId = parsed.id;
        }
        if (!result.cwdFromFirstMessage && typeof parsed.cwd === 'string' && parsed.cwd.length > 0) {
          result.cwdFromFirstMessage = parsed.cwd;
        }
        recordTimestamp(result, parsed.timestamp);
        return;
      }

      if (parsed.type === 'model_change') {
        const model = normalizeModel(parsed.provider, parsed.modelId ?? parsed.model);
        if (model) {
          currentModel = model;
          modelCounts[model] = modelCounts[model] ?? 0;
        }
        recordTimestamp(result, parsed.timestamp);
        return;
      }

      if (parsed.type !== 'message') return;
      const messageLine = parsed as PiMessageLine;
      result.messageCount++;
      recordTimestamp(result, messageLine.timestamp);

      const message = messageLine.message;
      const messageModel = typeof message?.model === 'string' && message.model.length > 0
        ? message.model
        : currentModel;
      if (messageModel) {
        modelCounts[messageModel] = (modelCounts[messageModel] ?? 0) + 1;
      }

      const usage = message?.usage;
      if (usage) {
        result.tokenInput += num(usage.input) + num(usage.cacheRead) + num(usage.cacheWrite);
        result.tokenOutput += num(usage.output);
      }

      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'toolCall' || typeof block.name !== 'string') continue;
          toolsSet.add(block.name);
          const filePath_ = extractFilePath(block.name, block.arguments);
          if (filePath_) filesSet.add(filePath_);
        }
      }
    });

    rl.on('close', finalize);
    rl.on('error', finalize);
    readStream.on('error', finalize);
  });

  result.modelsUsed = Object.keys(modelCounts);
  if (result.modelsUsed.length > 0) {
    result.primaryModel = result.modelsUsed.reduce((a, b) =>
      (modelCounts[a] ?? 0) >= (modelCounts[b] ?? 0) ? a : b,
    );
  }
  result.toolsUsed = [...toolsSet];
  result.filesTouched = [...filesSet];
  return result;
}

function emptySessionMetadata(): SessionMetadata {
  return {
    messageCount: 0,
    firstTs: null,
    lastTs: null,
    modelsUsed: [],
    primaryModel: null,
    tokenInput: 0,
    tokenOutput: 0,
    toolsUsed: [],
    filesTouched: [],
    sessionId: null,
    cwdFromFirstMessage: null,
  };
}

function recordTimestamp(result: SessionMetadata, ts: unknown): void {
  if (typeof ts !== 'string' || ts.length === 0) return;
  if (result.firstTs === null) result.firstTs = ts;
  result.lastTs = ts;
}

function normalizeModel(provider: unknown, model: unknown): string | null {
  if (typeof model !== 'string' || model.length === 0) return null;
  if (typeof provider === 'string' && provider.length > 0 && !model.includes('/')) {
    return `${provider}/${model}`;
  }
  return model;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function extractFilePath(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input || !FILE_TOOLS.has(toolName.toLowerCase())) return null;
  const path = input['file_path'] ?? input['path'] ?? input['file'];
  return typeof path === 'string' && path.length > 0 ? path : null;
}
