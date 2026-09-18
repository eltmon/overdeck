# Handoff brief: make Claude Code run OpenRouter's stealth/ox-alpha

## Goal
A PROVEN recipe (documented + demonstrated) for running a Claude Code session on the
OpenRouter model `stealth/ox-alpha`. The operator will use it to re-harness a fleet of
worker agents whose current harness (prime-agent) dies on this provider's intermittent
EMPTY completions. Claude Code's retry behavior is the reason for the switch.

## Context
- The operator already tried a Claude Code session with model stealth/ox-alpha and got
  "There's an issue with the selected model... may not exist" — that session was on
  direct Anthropic API billing, which doesn't know openrouter models.
- The operator also says they configured openrouter in CLIProxy and "it didn't work" —
  inspect ~/.overdeck/cliproxy/ (config.yaml is GENERATED; config.extra.yaml is the
  operator-owned overlay appended on every start; cliproxy.log has the evidence of
  their attempt). Figure out what they tried and why it failed before redoing it.
- CLIProxy serves Anthropic-schema at http://127.0.0.1:8317 and currently remaps
  claude model ids -> gpt-5.6 tiers via oauth-model-alias (codex OAuth upstream).
  Other LIVE Overdeck sessions depend on those aliases: your changes must be ADDITIVE
  and any cliproxy restart must preserve existing behavior (verify a gpt-5.6-aliased
  request still works after your change).
- An OpenRouter API key is available in the environment of running processes that use
  it (e.g. `tr '\0' '\n' < /proc/$(pgrep -f 'omp --model stealth/ox-alpha' | head -1)/environ | grep OPENROUTER_API_KEY`).
  NEVER print the key into logs, files, or your transcript beyond exporting it.

## Approach order
1. FIRST verify (WebSearch/WebFetch official OpenRouter docs): does OpenRouter expose an
   Anthropic-compatible Messages endpoint? If yes, the zero-infra path is:
   ANTHROPIC_BASE_URL=<that endpoint> ANTHROPIC_AUTH_TOKEN=$OPENROUTER_API_KEY \
     claude --model "stealth/ox-alpha" -p "Reply exactly: OX-CC-OK"
   Test it headless exactly like that (also test a 2-turn --resume to prove sessions
   persist, and one turn that uses a tool, e.g. ask it to run `echo hi` with
   --allowedTools "Bash(echo:*)" --permission-mode acceptEdits or a safe equivalent).
2. If no native endpoint (or it fails): wire CLIProxy. CLIProxy (CLIProxyAPI) supports
   OpenAI-compatible upstream providers via config (research the exact schema for the
   installed version — `~/.overdeck/cliproxy` binary/version; check its docs/repo).
   Add the openrouter upstream + model mapping in config.extra.yaml (ADDITIVE — do not
   touch the existing oauth-model-alias entries), restart cliproxy (note the pid file;
   Overdeck's src/lib/cliproxy.ts shows how it starts), then test:
   ANTHROPIC_BASE_URL=http://127.0.0.1:8317 ANTHROPIC_AUTH_TOKEN=<per cliproxy auth> \
     claude --model "stealth/ox-alpha" -p "Reply exactly: OX-CC-OK"
   And re-verify the pre-existing gpt-5.6 alias path still answers.
3. Whichever path works: ALSO verify the failure mode we care about — run 3 consecutive
   short sessions; if any turn ends empty, note whether Claude Code retried (that
   retry is the whole point of this migration).

## Deliverables
- ~/Projects/hoff-cliproxy-openrouter/RECIPE.md: the exact working invocation(s), env
  vars, any config added (key REDACTED), what was verified (incl. resume + tool call),
  and any caveats (rate limits, empty-completion behavior observed).
- If CLIProxy config was changed: the diff of config.extra.yaml (key redacted) inside
  RECIPE.md, and confirmation the legacy aliases still work.
- Final message: the recipe summary + PROVEN/NOT-PROVEN status per path.

## Rules
- Never print or commit the API key. Do not modify the Overdeck repo. Do not break the
  existing CLIProxy aliasing (verify after any restart). If both paths fail, document
  exactly why with the raw error evidence (redacted) — a clean negative is a valid result.
