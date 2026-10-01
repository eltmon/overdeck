// The claude-cli route (OVERDECK_EVAL_ANTHROPIC_VIA=claude-cli): runs an Anthropic eval call
// through `claude -p` on the operator's logged-in Claude subscription, for hosts with no
// ANTHROPIC_API_KEY. Returns the same { text, usage, stopReason } shape as the Messages API route.
// Multi-turn histories replay through a fabricated session JSONL under ~/.claude/projects/;
// those files are overwritten on rerun and never deleted (JSONL rule). `--bare` is never
// passed: it disables OAuth, which is the point of this route.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EvalModelConfig } from './eval-model.js';
import type { ProviderCallResult, ScenarioMessage } from './prompt-harness.js';

export const CLAUDE_CLI_CWD = path.join(os.tmpdir(), 'overdeck-eval-claude-cli');

// Claude Code's version string for the fabricated rows; the session format the run's patch used.
const SESSION_ROW_VERSION = '2.1.284';
// Assistant rows in a fabricated session carry this id prefix, so their replay is skipped on parse.
const REPLAYED_ID_PREFIX = 'msg_eval_';

/** Claude Code's project directory for a cwd: every non-alphanumeric character becomes '-'. */
export function claudeProjectDir(cwd: string, homeDir: string): string {
  return path.join(homeDir, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
}

/** A version-4-shaped UUID from sha256(input): deterministic, so reruns reuse one id. */
function uuidFromHash(input: string): string {
  const hex = createHash('sha256').update(input).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic UUID (version-4 shape) from sha256(model + JSON.stringify(history)), so reruns reuse one file. */
export function evalSessionId(model: string, history: ScenarioMessage[]): string {
  return uuidFromHash(model + JSON.stringify(history));
}

/** One JSONL row per prior turn, parentUuid-chained; assistant rows use ids `msg_eval_<i>`. */
export function buildSessionJsonl(opts: {
  model: string;
  cwd: string;
  sessionId: string;
  history: ScenarioMessage[];
  now: Date;
}): string {
  const { model, cwd, sessionId, history, now } = opts;
  let parentUuid: string | null = null;
  const rows = history.map((turn, i) => {
    const uuid = uuidFromHash(`${sessionId}:${i}`);
    const timestamp = new Date(now.getTime() - (history.length - i) * 1000).toISOString();
    const base = {
      isSidechain: false,
      userType: 'external',
      entrypoint: 'sdk-cli',
      cwd,
      sessionId,
      version: SESSION_ROW_VERSION,
      gitBranch: '',
      parentUuid,
      uuid,
      timestamp,
    };
    parentUuid = uuid;
    if (turn.role === 'user') {
      return { ...base, type: 'user', message: { role: 'user', content: turn.content } };
    }
    return {
      ...base,
      type: 'assistant',
      message: {
        id: `${REPLAYED_ID_PREFIX}${i}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: turn.content }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
  });
  return rows.map((row) => `${JSON.stringify(row)}\n`).join('');
}

export function buildClaudeCliArgs(config: EvalModelConfig, opts: { systemPromptFile: string; resumeSessionId: string | null }): string[] {
  return [
    '-p',
    '--model',
    config.apiModel,
    '--system-prompt-file',
    opts.systemPromptFile,
    '--tools',
    '',
    '--output-format',
    'stream-json',
    '--verbose',
    '--safe-mode',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    ...(config.effort !== null ? ['--effort', config.effort] : []),
    ...(opts.resumeSessionId !== null
      ? ['--resume', opts.resumeSessionId, '--fork-session', '--no-session-persistence']
      : ['--no-session-persistence']),
  ];
}

interface StreamContentBlock {
  type?: string;
  text?: string;
}

interface StreamEvent {
  type?: string;
  message?: { id?: string; content?: StreamContentBlock[] | string };
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    output_tokens_details?: { thinking_tokens?: number | null } | null;
  };
  modelUsage?: Record<string, unknown>;
}

/**
 * Parses `--output-format stream-json --verbose` stdout. When a reply hits the output cap the CLI
 * auto-continues: a synthetic `user` event ("Output token limit hit…") and further assistant
 * messages follow, and segments join with no separator. Only the text before that first `user`
 * event is kept, with stopReason 'max_tokens' (the API route truncates at the cap the same way).
 */
export function parseClaudeCliStream(stdout: string, config: EvalModelConfig): ProviderCallResult {
  const texts: string[] = [];
  let sawAssistant = false;
  let continued = false;
  let result: StreamEvent | null = null;

  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      continue;
    }
    if (event.type === 'assistant') {
      if (event.message?.id?.startsWith(REPLAYED_ID_PREFIX)) continue;
      sawAssistant = true;
      if (continued || !Array.isArray(event.message?.content)) continue;
      for (const block of event.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
      }
    } else if (event.type === 'user') {
      if (sawAssistant) continued = true;
    } else if (event.type === 'result') {
      result = event;
    }
  }

  if (result === null) throw new Error('claude CLI produced no result event');
  if (result.is_error === true) throw new Error(`claude CLI error: ${String(result.result ?? '').slice(0, 500)}`);

  // A silent CLI model fallback would score the wrong model.
  const served = Object.keys(result.modelUsage ?? {});
  if (served.length === 0 || !served.every((m) => m === config.apiModel || m === config.catalogId)) {
    throw new Error(`claude CLI served unexpected models [${served.join(', ')}] for ${config.apiModel}`);
  }

  const u = result.usage;
  if (!u) throw new Error('claude CLI result event has no usage');
  return {
    text: texts.join('\n'),
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      reasoningTokens: u.output_tokens_details?.thinking_tokens ?? null,
    },
    stopReason: continued ? 'max_tokens' : (result.stop_reason ?? null),
  };
}

export async function callClaudeCli(
  config: EvalModelConfig,
  prompt: { system: string; messages: ScenarioMessage[] },
  deps: { spawn?: typeof spawn; homeDir?: string; cwd?: string } = {},
): Promise<ProviderCallResult> {
  const spawnFn = deps.spawn ?? spawn;
  const cwd = deps.cwd ?? CLAUDE_CLI_CWD;
  const homeDir = deps.homeDir ?? os.homedir();
  mkdirSync(cwd, { recursive: true });

  // A file, not --system-prompt <text>: a large prompt can exceed Linux's 128 KiB single-argument limit.
  const systemHash = createHash('sha256').update(prompt.system).digest('hex').slice(0, 16);
  const systemPromptFile = path.join(cwd, `system-${systemHash}.txt`);
  writeFileSync(systemPromptFile, prompt.system, 'utf8');

  const history = prompt.messages.slice(0, -1);
  let resumeSessionId: string | null = null;
  if (history.length > 0) {
    resumeSessionId = evalSessionId(config.apiModel, history);
    const projectDir = claudeProjectDir(cwd, homeDir);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, `${resumeSessionId}.jsonl`),
      buildSessionJsonl({ model: config.apiModel, cwd, sessionId: resumeSessionId, history, now: new Date() }),
      'utf8',
    );
  }

  // Without ANTHROPIC_API_KEY the CLI uses the subscription login.
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(config.maxTokens) };
  delete env['ANTHROPIC_API_KEY'];

  const args = buildClaudeCliArgs(config, { systemPromptFile, resumeSessionId });
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawnFn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      err += chunk.toString();
    });
    child.on('error', (e: Error) => {
      reject(new Error(`claude CLI could not start: ${e.message} (is the claude CLI installed and logged in?)`));
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 500)} ${out.slice(0, 500)}`));
        return;
      }
      resolve(out);
    });
    // An early exit makes this write fail with EPIPE; the close handler reports the real failure.
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt.messages[prompt.messages.length - 1]!.content);
  });

  return parseClaudeCliStream(stdout, config);
}
