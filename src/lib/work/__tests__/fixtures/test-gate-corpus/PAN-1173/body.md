**Found during:** /all-up flywheel run, Phase 0 inventory (2026-05-18).

## Symptom

\`pan show 1148\` reports the agent as DEAD with \"tmux session is not running\", even though \`agent-pan-1148\` is actively running in \`tmux -L overdeck list-sessions\`. Same for \`pan show 1052\`, \`pan show 1170\`.

This makes the CLI useless for inspecting agent state on PAN-prefixed issues when the user types the bare issue number.

## Root cause

\`src/cli/commands/show.ts:50-52\`:
\`\`\`ts
const normalizedId = id.toLowerCase().replace(/^agent-/, '');  // \"1148\"
const issueId = normalizedId.toUpperCase();                     // \"1148\" (no prefix!)
const agentId = \`agent-\${normalizedId}\`;                        // \"agent-1148\" (wrong!)
\`\`\`

The comment claims the function accepts \"bare issue IDs (PAN-821)\" and \"prefixed agent IDs (agent-pan-821)\" — but it does NOT handle the bare-number case (\`1148\` without a prefix), which is what users actually type. \`pingAgent(agentId)\` then looks at \`~/.overdeck/agents/agent-1148/\` which doesn't have state.json, and reports dead.

As a side-effect of the failed lookup, \`pan show\` creates \`~/.overdeck/agents/agent-1148/cv.json\` and \`health.json\` — polluting the state directory with bogus entries for non-existent agents.

## Fix

When \`id\` is bare digits (no prefix):
1. Scan \`~/.overdeck/agents/\` for any directory matching \`agent-*-<num>\` with a valid \`state.json\`.
2. Or: resolve via \`projects.yaml\` — try each project's prefix and check if a state dir exists.

Either way, also stop writing cv.json/health.json to incorrect agent directories.

## Workaround

Until fixed: \`pan show PAN-1148\` (full prefix) or check \`tmux -L overdeck list-sessions\` directly. Dashboard API at \`/api/issues\` is the source of truth.

## Bonus

Same bug likely affects \`pan tell\`, \`pan kill\`, \`pan pause\`, \`pan unpause\`, \`pan untroubled\`, \`pan reopen\` if they share the same ID resolution. Audit the call sites.

--- comment ---
Code audit result: INCOMPLETE. Reopening.

I re-audited this against the original issue body and current main, using code and a local reproduction rather than prior close-out comments.

Evidence that `pan show <bare-number>` still fails in the source CLI path:
- `src/cli/commands/show.ts:55` calls `resolveBareNumericIdSync(id)`.
- `src/lib/issue-id.ts:144-179` is intended to scan `~/.overdeck/agents`, but `src/lib/issue-id.ts:151-164` uses `require('node:fs')` inside an ESM TypeScript module and silently returns `null` when run through the source CLI path.
- The dev/source CLI path is real here: `package.json` defines `dev`/source execution through `tsx`.

Reproduction run on current main:

```bash
tmp=$(mktemp -d /tmp/pan-1173-cli-XXXXXX)
mkdir -p "$tmp/.overdeck/agents/agent-pan-1148"
printf '{"issueId":"PAN-1148"}' > "$tmp/.overdeck/agents/agent-pan-1148/state.json"
HOME="$tmp" node --import tsx src/cli/index.ts show 1148
```

Output:

```text
Could not resolve issue ID "1148"
Pass a fully-qualified ID like "PAN-1148", or ensure the agent state dir exists at ~/.overdeck/agents/agent-<prefix>-<num>/
```

Additional audit evidence:
- `rg "resolveBareNumeric|bare number|1148" tests/lib/issue-id.test.ts tests/cli/commands/show.test.ts` found no regression assertion for this case.
- Related lifecycle commands still derive bare numeric IDs incorrectly: `src/cli/commands/tell.ts` maps bare `1148` to `agent-1148`, and `kill.ts`/`pause.ts`/`unpause.ts`/`untroubled.ts` call `resolveIssueIdSync(id)`, which leaves bare numeric IDs as `1148`.

What remains: fix bare numeric resolution in the source CLI path, add a regression test that constructs a temporary `~/.overdeck/agents/agent-pan-XXXX/state.json`, and audit/fix the related lifecycle commands that still derive `agent-<number>`.
