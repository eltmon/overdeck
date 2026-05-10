# PRD: Self-Modify Permission Handling — Stop the Interrupt Loop

## Vision

Work agents that legitimately need to modify Panopticon's own agent machinery
(`.claude/skills/...`, occasionally `.claude/agents/...`, etc.) can do so
without being trapped in a permission-dialog-dismissal loop, while the safety
guard against recursive self-modification remains intact for unscoped paths.

## Problem

Claude Code has an **inviolable safety guard** that prompts the user for
approval whenever an agent attempts to Edit or Write a file under its own
configuration tree (`.claude/`, `~/.claude/`). Unlike regular tool
permissions, `--dangerously-skip-permissions` deliberately does **not**
bypass this guard — it's the line that prevents an agent from rewriting
its own hooks/agent definitions/settings during a turn.

Today, work agents that need to legitimately modify these paths (e.g.
PAN-945 editing `.claude/skills/pan-tts/`, PAN-1055 editing
`.claude/skills/pipeline-status/`) get trapped in a loop:

1. Agent invokes Edit/Write on a `.claude/...` path
2. Claude Code displays a permission prompt: *"Do you want to make this edit?
   1. Yes / 2. Yes (don't ask again) / 3. No"*
3. **Anything that writes to the agent's pane dismisses the dialog as
   cancel** — a deacon idle-nudge, an orchestrator paste-buffer message,
   a hook printing to stdout, even raw output from a child process
4. Dismissal registers as cancel → tool call shows
   `Interrupted · What should Claude do instead?`
5. Agent retries → same prompt → same dismissal → same interrupt
6. Agent eventually gives up or sits stopped at an empty `❯` prompt with
   no way to make progress

PAN-945 has been stuck in this state multiple times today. The pattern
recurs whenever an issue's scope includes self-modify paths. The
work-around today is manual: human approves the prompt by hand at the
inspector's terminal panel, and only if no other actor races them.

## Goals

1. Eliminate the interrupt loop by construction — no race between
   permission dialogs and orchestrator/deacon writes.
2. Preserve the safety property: unscoped self-modification still
   requires explicit human approval. No issue gets blanket "edit
   anything under `.claude/`" power.
3. Surface unapproved self-modify attempts to the operator with the
   same precision that PAN-1030's awaiting-input indicator gives.
4. Keep changes narrow: no full sandbox/shadow-workspace overhaul.

## Non-goals

- A full sandboxed agent-machinery fork (option 4 from the design
  discussion — explicitly deferred as a months-of-work refactor).
- Changing Claude Code's safety guard itself (we don't own it).
- Allowing agents to modify `.claude/agents/`, `.claude/hooks/`,
  `.claude/settings.json`, or `~/.panopticon/` blanket. Those paths
  remain on the deny-list always (PAN-1024 substrate work already
  hardened those).

## Approach (Option 5 — combination)

Three coordinated changes:

### A. Per-issue allow-list at plan time

The plan-agent declares, in the vBRIEF or issue body, which
self-modify paths the implementation will touch. Examples:

- "modifies `.claude/skills/pan-tts/`"
- "modifies `.claude/skills/pipeline-status/`"

On `pan start <issue>`, Panopticon reads those declarations and
writes corresponding `allow` entries into the workspace's
`.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "Edit(.claude/skills/pan-tts/**)",
      "Write(.claude/skills/pan-tts/**)"
    ],
    "deny": [
      "Bash(rm .claude/agents/:*)",
      "Edit(.claude/agents/**)",
      "Write(.claude/agents/**)",
      "Edit(.claude/hooks/**)",
      "Write(.claude/hooks/**)",
      ...PANOPTICON_INFRA_DENY_PATTERNS
    ]
  }
}
```

Issues that don't declare self-modify paths get no `allow` additions —
they hit the prompt as before. The point is to make declared paths
flow without interruption while keeping undeclared paths gated.

The allow-list lives in the workspace's `settings.local.json` (already
the file `injectPanopticonInfraDeny` writes), so it's per-workspace
and disappears when the workspace is torn down.

### B. Outbound-write suppression during prompt display

`deliverAgentMessage` (the single delivery primitive in
`src/lib/agents.ts`) and any orchestrator that writes to a work-agent
pane (deacon idle-nudge, review-feedback delivery, conversation
panel, `pan tell`) must check for an active permission prompt in the
target pane **before** writing. If a prompt is detected, the write is
either:

- **Queued** — held until the prompt clears, then delivered
- **Refused with a structured error** — caller decides whether to retry

The detection is a tmux capture-pane scan for the canonical Claude
Code prompt strings:
- `Do you want to make this edit?`
- `Do you want to proceed?`
- `Esc to cancel · Tab to amend`
- `Enter to confirm · Esc to cancel`

If any of those are visible in the bottom 20 lines of the pane,
treat the agent as `prompt-blocked` and suppress orchestrator
writes. The Channels delivery path (when eligible) bypasses tmux
entirely and is unaffected.

### C. Awaiting-input indicator + inspector deep link

Extend the PAN-1030 awaiting-input surface to fire on the same
prompt-detection signal:

- Kanban card shows the INPUT badge with reason
  `tool_permission`
- Command Deck issue row shows the same badge with the actual
  prompt text in the tooltip
- Inspector shows the prompt verbatim plus a one-click "open
  terminal" deep link (already exists for PAN-1030's prompts —
  reuse the wiring)

When the user answers the prompt in the terminal panel, the badge
clears automatically (PAN-1030's existing behavior).

## Architecture

### Per-issue allow-list

- **vBRIEF schema** — add an optional `selfModifyPaths: string[]`
  field on the plan root. Validate the entries match
  `^\.claude/skills/[a-z0-9-]+(/.*)?$` (only skills today; agents
  and hooks remain off-limits without explicit human override).
- **Plan-agent prompt** — when planning, the plan-agent inspects
  the changeset it intends and writes `selfModifyPaths` if any
  match the regex. Encode this expectation in `roles/plan.md`
  (post-PAN-1048) or the planning prompt today.
- **`pan start` flow** — `injectPanopticonInfraDeny` already writes
  `.claude/settings.local.json`. Extend it to also read
  `selfModifyPaths` from the workspace vBRIEF and merge a
  corresponding `allow` block. Idempotent across re-spawn.
- **Mid-flight scope expansion** — if an agent attempts a path not
  in `selfModifyPaths`, it hits the prompt (correct behavior). The
  agent or operator can update the vBRIEF and re-spawn to extend
  the allow-list cleanly.

### Outbound-write suppression

- **`tmux.ts`** — add `isPanePromptBlocked(sessionName): Promise<boolean>`
  that captures the bottom of the pane and matches the canonical
  prompt strings.
- **`deliverAgentMessage`** in `agents.ts` — call
  `isPanePromptBlocked` before paste-buffer; on true, return a
  typed error `{ outcome: 'prompt-blocked' }`. Channels-eligible
  delivery skips this check (no tmux involved).
- **Deacon nudge sites** — wrap each `messageAgent` / `sendKeysAsync`
  to bail when prompt-blocked is detected. The deacon's stale-active
  fallback already handles "agent will be re-checked on next patrol";
  add a "prompt-blocked" branch that just logs and continues.
- **Conversation panel + `pan tell`** — same suppression. UI shows
  "agent is blocked on a permission prompt — answer it in the
  terminal first" instead of pasting silently.

### Awaiting-input extension

- **Heartbeat hook** — already detects pane state. Add prompt-string
  detection to its existing scan and emit `agent.prompt_blocked`
  event with the prompt text.
- **Read-model reducer** — handle `agent.prompt_blocked` to set
  `pendingQuestionReason: 'tool_permission'` and
  `pendingQuestionPrompt: <text>` (PAN-1030 already plumbed these
  fields).
- **Frontend** — no new component work needed; PAN-1030's badge +
  inspector wiring already renders these fields.

## Acceptance Criteria

### Per-issue allow-list (Section A)

- [ ] vBRIEF schema accepts an optional `selfModifyPaths: string[]`
      field with validation that limits entries to
      `^\.claude/skills/[a-z0-9-]+(/.*)?$`.
- [ ] `injectPanopticonInfraDeny` (or its successor) merges
      `Edit(<path>/**)` and `Write(<path>/**)` allow entries for each
      declared path.
- [ ] Re-running `pan start` is idempotent: allow-list entries are
      not duplicated.
- [ ] An issue with `selfModifyPaths: [".claude/skills/pan-tts/"]`
      can Edit/Write under that path without hitting a permission
      prompt.
- [ ] An issue without `selfModifyPaths` still hits the prompt for
      any `.claude/...` Edit (verified by manual test).
- [ ] An issue with `selfModifyPaths` attempting an UNdeclared path
      still hits the prompt (the allow-list does not blanket all
      `.claude/skills`).

### Outbound-write suppression (Section B)

- [ ] `isPanePromptBlocked(sessionName)` returns true when any of
      the canonical prompt strings is visible in the bottom 20 lines
      of the pane.
- [ ] `deliverAgentMessage` returns
      `{ success: false, outcome: 'prompt-blocked' }` when the
      target pane is prompt-blocked. The paste-buffer write does
      NOT fire.
- [ ] Deacon idle-nudge logs and skips when prompt-blocked.
- [ ] Conversation panel `pan tell` UI surfaces a "blocked on
      permission prompt" inline notice with a deep link to the
      inspector terminal panel.
- [ ] Channels-eligible delivery is unaffected (writes through MCP
      bypass the pane).

### Awaiting-input indicator (Section C)

- [ ] Heartbeat hook emits `agent.prompt_blocked` event with the
      observed prompt text.
- [ ] Kanban card shows the INPUT badge for any prompt-blocked
      agent.
- [ ] Inspector renders the prompt text verbatim and a one-click
      "open terminal at this pane" deep link.
- [ ] Badge clears within 5s of the user answering the prompt.

### End-to-end

- [ ] PAN-945's reproduction case (modifying `.claude/skills/`)
      runs to completion without any manual intervention if the
      issue declares `selfModifyPaths`.
- [ ] An issue that does NOT declare its self-modify paths hits
      the prompt, surfaces in the awaiting-input UI, the user
      answers in the terminal, agent proceeds. No interrupt
      loop, no orchestrator-write race.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Plan-agent fails to declare self-modify paths | Allow-list stays empty; falls back to today's behavior (prompts surface, user answers). No regression. |
| `isPanePromptBlocked` false-positive (matches a benign string) | Match only the exact canonical strings; capture only the bottom 20 lines; no full-pane scan. False-positives delay one orchestrator message at most. |
| Allow-list pattern syntax breaks Claude Code (PAN-1024 hit this with `Bash(rm:**)` mid-glob) | Use the same `:*`-trailing or `**` glob form already validated for the deny-list. Auto-scrub legacy invalid entries on every overlay write (already implemented in PAN-1024 substrate fix). |
| User answers a prompt while orchestrator queue is full | Queue is bounded; if `>N` queued messages exist when prompt clears, only the most recent N are flushed. Older nudges are stale anyway. |

## Out of scope

- Sandboxed/shadow-workspace agent-machinery fork (months of work, deferred).
- Allowing self-modify of `.claude/agents/`, `.claude/hooks/`, or
  `.claude/settings.json` via this mechanism. Those paths stay on
  the deny-list permanently.
- Cross-project allow-list policies (today's scope is per-workspace).
- The full PAN-1059 review-pipeline refactor (this PRD is a sibling
  improvement, not a dependency).

## Implementation order

1. **A** first (per-issue allow-list) — biggest immediate win, smallest
   surface area, no new contracts.
2. **B** second (outbound-write suppression) — eliminates the race
   class for any prompt that DOES still appear.
3. **C** last (awaiting-input extension) — UI polish, depends on B's
   detection helper.

Each section can ship independently; no big-bang.
