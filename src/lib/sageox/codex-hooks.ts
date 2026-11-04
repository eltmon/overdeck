/**
 * SageOx hooks for Codex launches (PAN-4852 WI-17, AD-23, AD-24).
 *
 * Codex loads `<CODEX_HOME>/hooks.json` as its User hook layer and runs a
 * non-managed hook only when `config.toml` records a matching trust hash
 * (`hooks.state."<hooks.json path>:<event_snake>:<group>:<handler>"`). For a
 * Codex launch with SageOx on, Overdeck writes the six `ox agent hook`
 * commands into the agent's `hooks.json` and pre-trusts exactly those six in
 * a marked block at the end of `config.toml`. It never uses
 * `--dangerously-bypass-hook-trust`, which would also run a repo's
 * `.codex/hooks.json` unreviewed. When SageOx is off, both are removed.
 *
 * The trust hash mirrors Codex's `fingerprint.rs` (`version_for_toml`):
 * sha256 of the compact JSON identity with every object's keys sorted.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { oxHookCommand } from './launch.js';

/** ox `cmd/ox-adapter-codex/hooks.go` `codexHookEvents` at the pinned commit. */
export const SAGEOX_CODEX_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd'] as const;
export const CODEX_TRUST_BLOCK_BEGIN = '# overdeck:sageox-hooks:begin';
export const CODEX_TRUST_BLOCK_END = '# overdeck:sageox-hooks:end';

/** `SessionStart` → `session_start`, the event name Codex uses in trust keys. */
export function codexEventSnake(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** AD-23: 30 s, except `SessionEnd`, which Codex clamps to 1..3 s. */
export function codexHookTimeout(event: string): number {
  return event === 'SessionEnd' ? 3 : 30;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .map(key => `${JSON.stringify(key)}:${sortedJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Codex's trusted hash for one group holding one command handler and no matcher (PRD 3.4). */
export function codexHookTrustHash(eventSnake: string, command: string, timeout: number): string {
  const identity = { event_name: eventSnake, hooks: [{ type: 'command', command, timeout, async: false }] };
  return `sha256:${createHash('sha256').update(sortedJson(identity)).digest('hex')}`;
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripTrustBlock(content: string): string {
  const begin = content.indexOf(CODEX_TRUST_BLOCK_BEGIN);
  if (begin === -1) return content;
  const end = content.indexOf(CODEX_TRUST_BLOCK_END, begin);
  const after = end === -1 ? content.length : end + CODEX_TRUST_BLOCK_END.length;
  return stripTrustBlock(content.slice(0, begin) + content.slice(after));
}

async function readConfig(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return '';
  }
}

async function writeTrustBlock(codexHome: string, block: string): Promise<void> {
  const path = join(codexHome, 'config.toml');
  const base = stripTrustBlock(await readConfig(path)).trimEnd();
  const next = [base, block].filter(Boolean).join('\n\n');
  await mkdir(codexHome, { recursive: true });
  await writeFile(path, next ? `${next}\n` : '', { mode: 0o600 });
  await chmod(path, 0o600);
}

/** AD-23 + AD-24: write `<codexHome>/hooks.json` and pre-trust its six hooks in `config.toml`. */
export async function writeSageoxCodexHooks(codexHome: string, env: Record<string, string>, bin: string): Promise<void> {
  await mkdir(codexHome, { recursive: true });
  // Codex keys trust by the symlink-resolved hooks.json path (PRD H3, verified live with 0.159.0).
  const hooksPath = join(await realpath(codexHome), 'hooks.json');
  const handlers = SAGEOX_CODEX_EVENTS.map(event => ({
    event,
    command: oxHookCommand(bin, env, 'codex', event),
    timeout: codexHookTimeout(event),
  }));
  const hooks = Object.fromEntries(handlers.map(({ event, command, timeout }) =>
    [event, [{ hooks: [{ type: 'command', command, timeout }] }]]));
  await writeFile(hooksPath, `${JSON.stringify({ hooks }, null, 2)}\n`, { mode: 0o600 });
  const block = [
    CODEX_TRUST_BLOCK_BEGIN,
    ...handlers.flatMap(({ event, command, timeout }) => {
      const snake = codexEventSnake(event);
      return [
        `[hooks.state."${escapeTomlBasicString(`${hooksPath}:${snake}:0:0`)}"]`,
        `trusted_hash = "${codexHookTrustHash(snake, command, timeout)}"`,
      ];
    }),
    CODEX_TRUST_BLOCK_END,
  ].join('\n');
  await writeTrustBlock(codexHome, block);
}

/** SageOx off: delete `hooks.json` and the trust block. Idempotent. */
export async function removeSageoxCodexHooks(codexHome: string): Promise<void> {
  await rm(join(codexHome, 'hooks.json'), { force: true });
  const path = join(codexHome, 'config.toml');
  const existing = await readConfig(path);
  if (!existing.includes(CODEX_TRUST_BLOCK_BEGIN)) return;
  await writeTrustBlock(codexHome, '');
}
