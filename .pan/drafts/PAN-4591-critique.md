plan-digest: a97694465dd87fd2041085574cd6ab27cc58a850734cf1e87551531fc85e541f

## blocks-the-design: resumed security reviewer loses Semgrep tools

The PRD says the review security lane gets the MCP server on every eligible launch (FR-5, lines 119–122), and WI-3 says adding `overdeckMcpServerNames` makes `overdeckMcpArgs` emit `mcp__semgrep` (lines 426–440). On resume, `src/lib/agents/spawn-prep.ts:800–802` calls `roleSystemPromptInjection(roleAgentDefinitionPath(launchRole))` with `launchRole === 'review'`, without the lane sub-role. `roles/review.md:9–13` has a `tools` list, so `src/lib/agents/runtime-command.ts:881–889` puts an existing `--allowedTools` flag on the base command. `src/lib/mcp/overdeck-mcp-args.ts:23–25` deliberately emits no new allow-list when that flag exists. The state fallback can add the server to the MCP file, but a resumed security reviewer cannot call it. WI-3's test passes bare `'claude'` to `overdeckMcpArgs` (PRD lines 455–459), so it misses this path. Ensure the real resumed reviewer launcher includes `mcp__semgrep` in its existing allow-list, and add a launcher-level resume test.

## blocks-the-design: Docker hook escapes the stated exclusion

D14 says Docker workspaces get no Semgrep (PRD lines 214–218). WI-2 checks `OVERDECK_DOCKER_WORKSPACE` and `PAN_DOCKER` for the MCP server, matching `src/lib/mcp/overdeck-mcp-gate.ts:15–19`. WI-5's `resolveSemgrepLaunchSettings` hook gate checks harness, config, conversation and platform, but neither Docker variable (PRD lines 557–578). `src/lib/skill-overrides/launcher-lines.ts:105–107` runs the launch-settings step for every local Claude launch, including Docker. With a managed launcher present, the work-role hook script then scans edits. Add the same Docker gate to hook injection and to the script, with tests for both environment variables.

## blocks-the-design: checkpoint can remove required harness support

FR-5 requires the Semgrep MCP server on Claude Code, Codex and ACP (PRD lines 119–122), and WI-8 requires both docs matrices to say Codex and ACP support it (PRD lines 688–705). The Codex/ACP checkpoint at PRD lines 744–748 instead instructs the implementer to return `null` for either harness and change its matrix cell to “no” if a tool call hangs. That fallback ships a known failure of FR-5; unit tests only verify server-map insertion (WI-3, lines 455–469), while the PRD says those clients were not tested live. Make successful Codex and ACP tool calls a required checkpoint, and resolve any `roots/list` compatibility issue before completion. A scope reduction needs an explicit requirement change.

## blocks-the-design: hook shim does not fail open

NFR-8 requires the hook to always exit `0` (PRD lines 148–150), but WI-4 specifies `set -euo pipefail` followed by `exec node "$SCRIPT_DIR/semgrep-edit-hook.js"` (lines 478–484). If the bundle is missing or cannot start, Node's nonzero exit reaches Claude; the `if [ -x <shim> ]` launch guard (WI-5, lines 570–578) checks only the shim. Re-running that command with a missing bundle returned `shim exit: 1`. Make the shim consume startup failures and return `0`, and add a missing-bundle test at the shell entry point.
