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
 * Effective context ceiling for the GPT-5.6 family routed through CLIProxy, and
 * the SINGLE source for that number: `getClaudeCodeContextPolicyForModel()` in
 * `src/lib/agents/provider-env.ts` exports it to the harness as
 * CLAUDE_CODE_MAX_CONTEXT_TOKENS / CLAUDE_CODE_AUTO_COMPACT_WINDOW, and the
 * capability table below feeds the dashboard meter, model-switch safety, and the
 * Deacon's proactive compaction. PAN-3057: those two surfaces disagreed (372K vs
 * gpt-5.5's 150K), which made a 186K session read ~18% full and silently disabled
 * proactive compaction for every GPT-5.6 agent.
 *
 * This is deliberately NOT the Codex CLI number. OpenAI cut the Codex client
 * catalog from 372K to 272K raw (258.4K effective) on 2026-07-13
 * (openai/codex#32806), but that cap is client-side: CLIProxy calls the backend
 * directly and is unaffected. Measured on this route AFTER the cut, gpt-5.6-sol
 * accepted 337,966–339,755 input tokens on eight consecutive days with zero
 * `input exceeds the context window` refusals. That ~338K plateau is Claude Code
 * auto-compacting at ~91% of this pin, so the real backend ceiling is >=340K and
 * has never been reached. Re-measure before lowering it.
 */
export const CLIPROXY_GPT56_CONTEXT_WINDOW = 372_000;
