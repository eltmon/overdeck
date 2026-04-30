/**
 * buildChildEnv — sanitized environment for spawned child processes.
 *
 * Problem (PAN-912): When the dashboard server is launched from inside a tmux
 * pane, process.env inherits TMUX/TMUX_PANE. Spawning further tmux processes
 * with these vars present causes "sessions should be nested with care" failures.
 * The same leak applies to screen (STY) and provider env vars that would
 * mis-route a child to the wrong API endpoint.
 *
 * This helper strips known-leaky artifacts and applies caller overrides.
 * Use it anywhere you would otherwise write `{ ...process.env, ...overrides }`.
 */

/** Env vars that leak from a parent shell / tmux / screen and must not reach children. */
const LEAKED_ENV_KEYS = new Set([
  'TMUX',
  'TMUX_PANE',
  'STY', // GNU screen session name
  'WINDOW', // GNU screen window number
]);

/** Provider-specific keys that must be cleared before re-routing a child. */
const PROVIDER_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
]);

/** All keys that should be stripped by default. */
const STRIPPED_KEYS = new Set([...LEAKED_ENV_KEYS, ...PROVIDER_ENV_KEYS]);

/**
 * Build a sanitized child environment.
 *
 * @param baseEnv  Source environment (default: process.env). Only string values are copied.
 * @param overrides  Key/value pairs to overlay AFTER stripping.
 * @returns  A plain object safe to pass to spawn, pty.spawn, etc.
 */
export function buildChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  overrides?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    if (STRIPPED_KEYS.has(k)) continue;
    out[k] = v;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Provider env vars set to empty strings — for tmux -e overrides.
 *
 * tmux -e can only SET vars, not UNSET inherited ones. The tmux server
 * inherits the parent's env (including stale provider vars like
 * ANTHROPIC_BASE_URL). Passing these as empty via -e overrides the
 * server's inherited values. The launcher script's `unset` + `export`
 * then sets the correct values for the child process.
 */
export const BLANKED_PROVIDER_ENV: Record<string, string> = Object.fromEntries(
  [...PROVIDER_ENV_KEYS].map(k => [k, '']),
);

/**
 * Variant that strips ONLY tmux/screen artifacts (not provider keys).
 * Use this when the caller will handle provider env separately (e.g. launcher scripts).
 */
export function buildChildEnvWithoutTmux(
  baseEnv: NodeJS.ProcessEnv = process.env,
  overrides?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    if (LEAKED_ENV_KEYS.has(k)) continue;
    out[k] = v;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      out[k] = v;
    }
  }
  return out;
}
