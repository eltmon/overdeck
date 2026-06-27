---
scope: dev
---
### Never force `--harness claude-code` for a CLIProxy-routed model — trust the provider default

When spawning ANY agent (work, strike, plan, conversation), do NOT override `--harness` to
`claude-code` for a non-native, CLIProxy-routed model — kimi (`kimi-k2.*`), gpt-5.5, glm,
gemini-via-pi, etc. Claude Code routes those through CLIProxy, which advertises a false ~200k
context window; long sessions sail past it and **deadlock** (the "200k-window illusion",
PAN-1865). A $22 silent burn and a stranded critical red-main strike both came from exactly this.

**Trust the provider default routing — it exists to prevent this:** kimi → ohmypi (omp), gpt-5.5 → codex,
native Anthropic models (`claude-*`) → claude-code. Run `pan strike <id>` / `pan start <id>` with
**no `--harness`** (and no `--model`) unless the operator explicitly asked — and never pair
`--harness claude-code` with a CLIProxy model. `claude-code` is correct only for native Anthropic
models; reaching for it because it feels "more reliable" for a critical fix is the exact trap.

This is an orchestrator-knowledge rule, deliberately NOT enforced in `resolveHarness`: a hard
refusal would block PAN-1865's goal of eventually making claude-code safe for kimi. The
orchestrator (you, and the flywheel) simply knows better.
