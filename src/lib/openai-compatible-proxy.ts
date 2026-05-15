import http from 'http';
const HOST = '127.0.0.1';
const PORT = 12436;

const UPSTREAMS: Record<string, string> = {
  nous: 'https://inference-api.nousresearch.com/v1',
};

let server: http.Server | null = null;
let started = false;

export function getOpenAICompatibleProxyBaseUrl(provider: string): string {
  return `http://${HOST}:${PORT}/${provider}`;
}

export async function ensureOpenAICompatibleProxyRunning(): Promise<void> {
  if (started && server?.listening) return;
  if (await isPortOpen()) {
    started = true;
    return;
  }

  server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(PORT, HOST, () => {
      server!.off('error', reject);
      started = true;
      resolve();
    });
  });
}

async function isPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/health', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const match = req.url?.match(/^\/([^/]+)\/v1\/(messages|models)$/);
  if (!match) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Unknown proxy route' } }));
    return;
  }

  const [, provider, route] = match;
  const upstream = UPSTREAMS[provider];
  if (!upstream) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Unknown provider: ${provider}` } }));
    return;
  }

  const upstreamKey = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!upstreamKey) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Missing upstream API key' } }));
    return;
  }

  if (route === 'models') {
    await proxyModels(upstream, upstreamKey, res);
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
    return;
  }

  const body = JSON.parse(await readBody(req)) as AnthropicMessagesRequest;
  await proxyMessages(upstream, upstreamKey, body, res);
}

async function proxyModels(upstream: string, apiKey: string, res: http.ServerResponse): Promise<void> {
  const response = await fetch(`${upstream}/models`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  });
  const text = await response.text();
  res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
  res.end(text);
}

async function proxyMessages(
  upstream: string,
  apiKey: string,
  body: AnthropicMessagesRequest,
  res: http.ServerResponse,
): Promise<void> {
  const wantsStream = body.stream === true;
  const openAiBody = toOpenAIRequest(body);

  const response = await fetch(`${upstream}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(openAiBody),
  });

  const text = await response.text();
  if (!response.ok) {
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(text);
    return;
  }

  const completion = JSON.parse(text) as OpenAICompletion;
  const anthropic = toAnthropicResponse(completion, body.model);

  if (!wantsStream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(anthropic));
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeSse(res, 'message_start', { type: 'message_start', message: { ...anthropic, content: [] } });
  for (let i = 0; i < anthropic.content.length; i += 1) {
    const block = anthropic.content[i]!;
    writeSse(res, 'content_block_start', { type: 'content_block_start', index: i, content_block: emptyBlock(block) });
    if (block.type === 'text' && block.text) {
      writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'tool_use') {
      writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: i });
  }
  writeSse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: anthropic.stop_reason, stop_sequence: null }, usage: anthropic.usage });
  writeSse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emptyBlock(block: AnthropicContentBlock): AnthropicContentBlock {
  if (block.type === 'text') return { type: 'text', text: '' };
  return { type: 'tool_use', id: block.id, name: block.name, input: {} };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function toOpenAIRequest(body: AnthropicMessagesRequest): Record<string, unknown> {
  const messages: OpenAIMessage[] = [];
  const system = typeof body.system === 'string'
    ? body.system
    : Array.isArray(body.system)
      ? body.system.map(blockToText).filter(Boolean).join('\n')
      : '';
  if (system) messages.push({ role: 'system', content: system });

  for (const message of body.messages ?? []) {
    messages.push(...toOpenAIMessages(message));
  }

  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    stream: false,
    tools: body.tools?.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    })),
    tool_choice: body.tool_choice?.type === 'auto' ? 'auto' : undefined,
  };
}

function toOpenAIMessages(message: AnthropicMessage): OpenAIMessage[] {
  if (typeof message.content === 'string') {
    return [{ role: message.role, content: message.content }];
  }

  const textParts: string[] = [];
  const toolMessages: OpenAIMessage[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of message.content) {
    if (block.type === 'text') textParts.push(block.text ?? '');
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    if (block.type === 'tool_result') {
      toolMessages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: toolResultText(block.content) });
    }
  }

  if (message.role === 'assistant') {
    return [{ role: 'assistant', content: textParts.join('\n') || null, tool_calls: toolCalls.length ? toolCalls : undefined }];
  }

  return [{ role: 'user', content: textParts.join('\n') || ' ' }, ...toolMessages];
}

function blockToText(block: unknown): string {
  if (typeof block === 'string') return block;
  if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') return block.text;
  return '';
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockToText).filter(Boolean).join('\n');
  return JSON.stringify(content ?? '');
}

function toAnthropicResponse(completion: OpenAICompletion, fallbackModel: string): AnthropicMessageResponse {
  const choice = completion.choices?.[0];
  const message = choice?.message ?? {};
  const content: AnthropicContentBlock[] = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const call of message.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parseJsonObject(call.function.arguments),
    });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    id: completion.id ?? `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: completion.model ?? fallbackModel,
    content,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

interface AnthropicMessagesRequest {
  model: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  system?: string | Array<{ text?: string }>;
  messages?: AnthropicMessage[];
  tools?: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
  tool_choice?: { type?: string };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicInputBlock[];
}

type AnthropicInputBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown };

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use';
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
};

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAICompletion {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
