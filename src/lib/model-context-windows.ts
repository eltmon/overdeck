/**
 * Effective context-window ceilings for models routed through CLIProxy.
 *
 * Separate from the capability table because two surfaces must agree on them:
 * the capability entry (dashboard meter, model-switch safety, the Deacon's
 * proactive compaction) and the harness env pin that
 * `getClaudeCodeContextPolicyForModel()` exports as CLAUDE_CODE_MAX_CONTEXT_TOKENS
 * / CLAUDE_CODE_AUTO_COMPACT_WINDOW. PAN-3057: they drifted apart and a 186K
 * GPT-5.6 session read ~18% full, so proactive compaction never fired.
 */

/**
 * Conservative effective ceiling for Codex/ChatGPT subscription models routed
 * through CLIProxy into Claude Code. Claude Code's native auto-compact path does
 * not know the proxied model's larger marketing window; the harness status line
 * reports a 200.0k budget for gpt-5.5 sessions, and PAN-1615 observed hard
 * `input exceeds the context window` 400s instead of a native pre-ceiling
 * compaction. See the context-overflow recovery note in
 * `src/lib/cloister/deacon.ts` for why the deacon owns this recovery path.
 *
 * PAN-1672: 200k is gpt-5.5's *marketing* window, not its effective one via
 * CLIProxy — the backend 400s with `input exceeds the context window` well
 * before 85% of 200k (≈170k) is reached, so proactive compaction (keyed to this
 * budget at CONTEXT_PROACTIVE_COMPACT_HIGH_WATER_PERCENT) never fires in time
 * and agents hard-wedge. Set a conservative effective ceiling so the 85%
 * high-water (≈127.5k) lands comfortably below the real failure zone. Tune up
 * if gpt-5.5's true CLIProxy window is later measured to be higher.
 */
export const CLIPROXY_CODEX_CONTEXT_WINDOW = 150_000;

/**
 * Default context pin for the GPT-5.6 family routed through CLIProxy, and the
 * SINGLE source for that number: `getClaudeCodeContextPolicyForModel()` in
 * `src/lib/agents/provider-env.ts` exports it to the harness as
 * CLAUDE_CODE_MAX_CONTEXT_TOKENS / CLAUDE_CODE_AUTO_COMPACT_WINDOW, and the
 * capability table feeds the dashboard meter, model-switch safety, and the
 * Deacon's proactive compaction. PAN-3057: those two surfaces disagreed (372K vs
 * gpt-5.5's 150K), which made a 186K session read ~18% full and silently disabled
 * proactive compaction for every GPT-5.6 agent.
 *
 * PAN-3388: 272K is a BILLING tier, not a capability limit. All three GPT-5.6
 * models share a 1.05M raw window, but OpenAI prices "prompts with >272K input
 * tokens at 2x input and 1.5x output for the full request"
 * (https://developers.openai.com/api/docs/models/gpt-5.6-sol — same note on
 * -terra and -luna). OpenAI cut Codex's own client window 372K→272K because the
 * 372K profile "caused more subscription usage to be charged than intended"
 * (openai/codex#34619) and advises non-Codex harnesses to pin 272K. Defaulting
 * higher makes every long session burn subscription quota at 2x for its whole
 * tail, so the bare model ids pin here and auto-compact at ~91% (~248K), under
 * the tier. Sessions that genuinely need the longer window opt in via the
 * `[372k]` variants below.
 */
export const CLIPROXY_GPT56_CONTEXT_WINDOW = 272_000;

/**
 * Opt-in long-context ceiling for the `gpt-5.6-*[372k]` variants. This is the
 * measured-safe backend ceiling, deliberately NOT the Codex CLI number: the
 * Codex 272K cap is client-side, CLIProxy calls the backend directly. Measured
 * on this route after the Codex cut, gpt-5.6-sol accepted 337,966–339,755 input
 * tokens on eight consecutive days with zero `input exceeds the context window`
 * refusals — that ~338K plateau is Claude Code auto-compacting at ~91% of this
 * pin, so the real backend ceiling is >=340K and has never been reached.
 * Everything past 272K input is billed at 2x input / 1.5x output for the full
 * request (see above) — the variants exist for operators who accept that cost
 * for fewer compactions. Re-measure before lowering.
 */
export const CLIPROXY_GPT56_LONG_CONTEXT_WINDOW = 372_000;

/**
 * Overdeck-side long-context variant ids → the API model id the backend knows.
 * The suffix is meaningful only inside Overdeck (context pins, capability
 * entries, pickers); CLIProxy and the ChatGPT backend have never heard of it,
 * so the launch door (`shellQuoteModelIdSync`) strips it via
 * `apiLaunchModelIdSync()` before the id reaches any harness CLI. Kimi's
 * `k3[1m]` is NOT in this map — that suffix is a real Kimi endpoint alias.
 */
export const GPT56_LONG_CONTEXT_VARIANTS: Record<string, string> = {
  'gpt-5.6-sol[372k]': 'gpt-5.6-sol',
  'gpt-5.6-terra[372k]': 'gpt-5.6-terra',
  'gpt-5.6-luna[372k]': 'gpt-5.6-luna',
};

/**
 * Context-window pins for OpenRouter models launched under the claude-code
 * harness. OpenRouter's catalog is dynamic, but the harness env pin
 * (CLAUDE_CODE_MAX_CONTEXT_TOKENS / CLAUDE_CODE_AUTO_COMPACT_WINDOW) is
 * resolved synchronously at launcher-generation time, so models the fleet
 * depends on get a static entry here, sourced from OpenRouter's
 * /api/v1/models `context_length`. Claude Code does not recognize these ids
 * and would otherwise assume a 200K window. Models absent from this map get
 * no pin (Claude Code's 200K default applies).
 */
export const OPENROUTER_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'stealth/ox-alpha': 1_048_576,
};

/** True when `modelId` is an Overdeck-side GPT-5.6 long-context variant. */
export function isGpt56LongContextVariantSync(modelId: string): boolean {
  return modelId in GPT56_LONG_CONTEXT_VARIANTS;
}

/**
 * Resolve the model id to launch a harness with: long-context variants map to
 * their base API model id, everything else passes through unchanged.
 */
export function apiLaunchModelIdSync(modelId: string): string {
  return GPT56_LONG_CONTEXT_VARIANTS[modelId] ?? modelId;
}
