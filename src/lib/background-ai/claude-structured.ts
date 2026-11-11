/**
 * Shared hardened `claude -p` runner for background structured-output calls.
 *
 * Moved out of `conversations/transcript-summary.ts` (PAN-4374 WI-1) so the
 * memory-extraction `claude-cli` provider can reuse the exact same spawn
 * hardening and envelope parsing that conversation titles already rely on,
 * without the memory provider stack creating a new import cycle.
 *
 * This module must NEVER import `../agents.js` or `../agents/provider-env.js`,
 * statically or dynamically: `agents/provider-env.ts` reaches
 * `memory/providers/registry.ts` (via `agent-state.ts` and
 * `feature-registry-population.ts`), and the memory provider registry imports
 * the `claude-cli` provider, which imports this module — closing a new cycle.
 * Provider env is instead supplied by the caller via `providerEnv`, resolved
 * after the Claude Code minimum-version check (see `runClaudeStructured`).
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildChildEnv } from '../child-env.js';
import { getOverdeckHome } from '../paths.js';
import { getModelEffortLevels } from '../model-capabilities.js';

/**
 * PAN-2657 hardening: these utility calls emit one schema-constrained JSON
 * object and must be COMPLETELY unable to act. A summarizer spawned with
 * default tool access once adopted the transcript's momentum and wrote
 * production code into the live checkout (main saw `fs-lock.ts` appear from a
 * dead session). Three independent gates:
 *
 *  - `--safe-mode` + `--setting-sources ''` skip hooks, settings allowlists,
 *    MCP, and CLAUDE.md from the cwd and `~/.claude` — a repo's permissive
 *    settings can never re-arm it. (Formerly `--bare`, but as of Claude Code
 *    2.1.209 `--bare` also skips credential reads, so every spawn failed with
 *    "Not logged in" under subscription OAuth; `--safe-mode` explicitly keeps
 *    auth working.)
 *  - `--tools ''` + `--disallowedTools mcp__*` strip every built-in and MCP
 *    tool so the model never sees a tool definition;
 *  - `--permission-mode dontAsk` auto-denies (never prompts, never hangs) if
 *    anything slips through.
 *
 * The spawn cwd is an empty scratch directory so even a hypothetical escape
 * has no repository to land in. Locked by transcript-summary-hardening tests.
 */
export function buildStructuredClaudeArgs(schema: Record<string, unknown>, model: string): string[] {
  return [
    '-p',
    '--safe-mode',
    '--setting-sources', '',
    '--tools', '',
    '--disallowedTools', 'mcp__*',
    '--permission-mode', 'dontAsk',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--model', model,
    // PAN-5124 FR-3: titles and the About summary need no reasoning. Pin low
    // effort only for models whose own row lists it (D2); Haiku 4.5 has none.
    ...(getModelEffortLevels(model)?.includes('low') ? ['--effort', 'low'] : []),
  ];
}

/** Empty scratch cwd for background AI utility spawns — never a repository. */
export function backgroundAiScratchCwd(): string {
  const dir = join(getOverdeckHome(), 'tmp', 'background-ai');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ClaudeStructuredFailure {
  exitCode: number | null;
  resultText: string | null;
  apiErrorStatus: number | null;
  authFailure: boolean;
}

/** A `claude -p` utility call that ran and failed (non-zero exit or `is_error: true`). */
export class ClaudeStructuredCallError extends Error {
  readonly name = 'ClaudeStructuredCallError';
  constructor(message: string, readonly failure: ClaudeStructuredFailure) {
    super(message);
  }
}

const CLAUDE_AUTH_FAILURE_PATTERN = /not logged in|please run \/login|invalid api key|oauth token has expired|authentication_error|unauthorized/i;

export function isClaudeAuthFailure(text: string | null, apiErrorStatus: number | null): boolean {
  if (apiErrorStatus === 401 || apiErrorStatus === 403) return true;
  return text !== null && CLAUDE_AUTH_FAILURE_PATTERN.test(text);
}

export interface RunClaudeStructuredInput {
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Appended after buildStructuredClaudeArgs(); never replaces the hardening flags. */
  extraArgs?: readonly string[];
  /**
   * Extra env overlaid on buildChildEnv(), resolved AFTER the Claude Code
   * minimum-version check. Titles pass getProviderEnvForModel; the memory
   * provider passes nothing (this module must not import agents/provider-env).
   */
  providerEnv?: (model: string) => Promise<Record<string, string>>;
}

export interface RunClaudeStructuredDeps {
  spawn?: typeof spawn;
  resolveBinary?: (model: string) => Promise<string>;
}

async function defaultResolveBinary(model: string): Promise<string> {
  // PAN-5124 FR-5: refuse a too-old Claude Code before any process starts.
  const { prepareHarnessLaunch } = await import('../harness-binary.js');
  return (await prepareHarnessLaunch('claude-code', { model })).binaryPath;
}

function readEnvelope(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function envelopeResultText(envelope: Record<string, unknown> | null): string | null {
  return envelope && typeof envelope['result'] === 'string' ? (envelope['result'] as string) : null;
}

function envelopeApiErrorStatus(envelope: Record<string, unknown> | null): number | null {
  return envelope && typeof envelope['api_error_status'] === 'number' ? (envelope['api_error_status'] as number) : null;
}

/** Run one hardened `claude -p` call and return its parsed stdout envelope. */
export async function runClaudeStructured(
  input: RunClaudeStructuredInput,
  deps: RunClaudeStructuredDeps = {},
): Promise<Record<string, unknown>> {
  if (input.signal?.aborted) {
    throw new Error('claude invocation aborted');
  }

  const resolveBinary = deps.resolveBinary ?? defaultResolveBinary;
  const spawnFn = deps.spawn ?? spawn;

  const binaryPath = await resolveBinary(input.model);
  const providerEnv = await input.providerEnv?.(input.model) ?? {};
  const env = { ...buildChildEnv(), ...providerEnv };
  const args = [...buildStructuredClaudeArgs(input.schema, input.model), ...(input.extraArgs ?? [])];

  // The signal may have aborted while resolveBinary/providerEnv were in
  // flight — re-check before spawning so a listener attached below (after an
  // already-fired abort event) is never the only thing standing between us
  // and a hung promise.
  if (input.signal?.aborted) {
    throw new Error('claude invocation aborted');
  }

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    const child = spawnFn(binaryPath, args, { env, cwd: backgroundAiScratchCwd() });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`claude invocation timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill('SIGTERM');
      reject(new Error('claude invocation aborted'));
    };
    input.signal?.addEventListener('abort', onAbort);

    const removeAbortListener = () => input.signal?.removeEventListener('abort', onAbort);

    let out = '';
    let errOut = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (data: string) => { out += data; });
    child.stderr.on('data', (data: string) => { errOut += data; });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeAbortListener();
      reject(err);
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeAbortListener();

      const envelope = readEnvelope(out);
      const resultText = envelopeResultText(envelope);
      const apiErrorStatus = envelopeApiErrorStatus(envelope);

      if (envelope?.['is_error'] === true) {
        const authFailure = isClaudeAuthFailure(resultText ?? (errOut.trim() || null), apiErrorStatus);
        reject(new ClaudeStructuredCallError(`claude -p failed: ${resultText ?? 'unknown error'}`, {
          exitCode: code,
          resultText,
          apiErrorStatus,
          authFailure,
        }));
        return;
      }

      if (code !== 0) {
        const message = errOut.trim() || resultText || `claude invocation exited with code ${code}`;
        const authFailure = isClaudeAuthFailure(errOut.trim() || resultText, apiErrorStatus);
        reject(new ClaudeStructuredCallError(message, {
          exitCode: code,
          resultText,
          apiErrorStatus,
          authFailure,
        }));
        return;
      }

      if (envelope === null) {
        reject(new Error('claude invocation returned unparseable output'));
        return;
      }

      resolve(envelope);
    });

    try {
      child.stdin.write(input.prompt, 'utf-8');
      child.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeAbortListener();
      child.kill('SIGTERM');
      reject(err as Error);
    }
  });
}
