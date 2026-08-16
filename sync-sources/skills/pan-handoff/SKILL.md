---
name: pan-handoff
description: "pan handoff <conv> — agent-authored conversation handoff that spawns a new conversation. Keep the focus short and steering; the hard cap is 10000 characters (PAN-3737)."
triggers:
  - pan handoff
  - hand off conversation
  - agent handoff
  - context handoff
  - fork with handoff
allowed-tools:
  - Bash
  - Read
---

# pan handoff

Create a new conversation seeded by a handoff document written by the live source agent.

## Quick command

```bash
pan handoff [conv] [focus text...]
```

The trailing text after the conversation reference becomes the focus — no flag required.

> Keep the focus short and steering; do NOT pack backstory/context into it — the author reads the full source transcript for that, and long briefs belong in a file the focus points at. The hard cap is 10,000 characters (multi-line is fine; PAN-3737) — a longer focus is rejected with `Fork request rejected: focus must be 10000 characters or fewer` and no conversation is created.

## Where to run it, and where the successor lives

Two separate directories are involved, and each has its own rule:

- **Run the command from your project directory** (the directory your session was launched in). Do NOT `cd` into the `--cwd` target, a `/tmp` brief directory, or any other path first — `--cwd` is where the *successor* will live; you never need to stand there. Sandboxed harnesses (e.g. codex `workspace-write`) block network and non-workspace writes for commands run from untrusted directories. The failure signature is `attempt to write a readonly database` followed by `Could not reach the Overdeck dashboard at http://127.0.0.1:3011 … (fetch failed)` **while the dashboard is actually up** — if you see that pair, re-run from your project directory (PAN-3735).
- **`--cwd` must be an absolute path to an existing directory under your home directory, inside a git working tree.** The server rejects violations and creates no conversation: `/tmp/...` fails the home-containment check (`Invalid cwd`), a relative path like `../worktree` fails the absolute-path check (the CLI does not resolve it for you), a not-yet-created directory fails the existence check, and a plain non-git directory fails with `Handoff cwd is not inside a git repository`. The reliable recipe is an isolated worktree: `git -C <repo> worktree add -b hoff/<slug> "$HOME/hoff-<slug>-wt" main`, put any brief files in it, then pass it as `--cwd`. In a polyrepo project whose parent directory is not itself a git repo, point `--cwd` at (a worktree of) the relevant sub-repo — the parent fails the git check.

## Handing off the conversation you are in (the common case)

**If you are an agent inside a conversation and want to hand off *your own*
conversation, omit `<conv>` — or pass `self`.** Do NOT run `pan conv scan`,
`pan conv list`, or `pan conv show` to "find yourself" and then guess an id.
That scan-and-guess pattern picks the wrong source (PAN-1520); the command
identifies your conversation deterministically from the session you are running
in.

```bash
pan handoff                              # hand off this conversation, no focus
pan handoff self wire the Stripe webhook # hand off this conversation, with focus
```

Because focus text is positional, prefer the explicit `self` token whenever you
pass focus — a bare first word like `pan handoff continue the wiring` is
interpreted as a *conversation reference* named "continue", not focus. `self`
removes the ambiguity.

If you want to know which conversation you are resolved to, run `pan conv current`
(alias `pan conv whoami`). It prints the deterministic answer with no guessing.

Self-detection works for non-Docker `claude-code` conversations. If it cannot
resolve (run outside a conversation, or a Docker workspace), the command errors
and asks for an explicit `<conv>` — it never falls back to a guess.

## Usage

```bash
pan handoff                              # hand off the conversation you are in
pan handoff self continue the API wiring # same, with focus
pan handoff 42
pan handoff source-conv continue the API wiring
pan handoff source-conv --model claude-sonnet-4-6
pan handoff source-conv --harness pi
pan handoff source-conv --cwd /home/you/Projects/project
pan handoff source-conv --cwd /home/you/Projects/isolated-worktree --project mind-your-now
pan handoff source-conv --model claude-opus-4-7 wire the Stripe webhook into checkout
pan handoff source-conv --author external --author-model claude-haiku-4-5 cheap clean handoff
pan handoff source-conv --author source uses-source-agent-and-pollutes-its-context
pan handoff source-conv --issue PAN-1234 continue the API wiring
```

## Project and issue association

Use `--project <key-or-name>` when the successor runs from a `--cwd` outside the registered project's directory, such as an isolated worktree. The `--cwd` value must be an absolute path to an existing directory under your home directory (see "Where to run it, and where the successor lives" above). The explicit project wins over the source association; without the flag, the successor inherits the source conversation's project. Unknown projects reject the request and create no conversation.

Use `--issue <id>` to attach the new conversation to a specific issue (e.g. `PAN-1234`). The flag is validated; an invalid ID rejects the request and creates no conversation. When `--issue` is omitted, the new conversation inherits the source conversation's issue association, if any.

## When to use

- A long-running conversation is near the context wall.
- The current agent knows dead ends, hazards, or file relationships that a passive summary may miss.
- You want a deliberate context transfer before switching models, harnesses, or tasks.

Use a normal summary fork when a quick passive summary is enough. Use a plain fork only when staying within Claude Code-compatible raw history.

## Focus

The positional text after `<conv>` is the focus — a short statement of what the successor should concentrate on. Quotes are optional; everything after the conversation reference (excluding flags) is joined with spaces. Keep it short and task-oriented; the focus is injected into the handoff-authoring prompt, not used as the new conversation's user request.

**Hard ceiling: 10,000 characters** (PAN-3737; multi-line focus is allowed). Don't pack the backstory into the focus even so; the detail belongs in the transcript the author reads or in a brief file in the successor cwd. The focus only steers what the author emphasizes, and its first ~70 characters become the new conversation's title.

## Authoring modes

`--author external` (default) spawns a separate authoring session that reads the source JSONL transcript and writes the handoff document. The source conversation is never contacted — its context stays clean, and the source can be ended. Use `--author-model` and `--author-harness` to choose the authoring model and harness independently of the source and of the new conversation. Cheaper models work well for routine handoffs; reach for a larger model when the conversation has nuance the document needs to preserve.

`--author source` asks the live source agent to write the handoff document in-conversation. This adds the prompt and the doc to the source's transcript (polluting its context) and uses whatever model the source is currently running. It can still be the right choice when the source agent has live state — open files, recent commands, in-flight reasoning — that a transcript reader would miss.

## Fallback behavior

`pan handoff <conv>` always attempts to create a usable new conversation. If the live-agent handoff cannot complete, Overdeck falls back to a summary fork and prints the fallback reason. An oversized source conversation is never a hard failure: it is auto-degraded through a truncated smart summary, then a heuristic fallback, then a focus-only seed, and the handoff still spawns.

Common fallback reasons:

- `source-ended` — the source conversation is already ended.
- `handoff-timeout` — the source did not write both the document and `.done` sentinel in time.
- `handoff-validation` — the document did not satisfy the handoff contract.
- `source-workspace-devcontainer` — the source cannot write to the host handoff directory from a workspace container.
- `handoff-request-failed` — the authoring request failed (e.g., context overflow) and the system fell back to a degraded summary.

## Output

Successful handoffs print the new conversation id, tmux session, model, harness, dashboard link, and handoff doc path. Fallbacks print the same new conversation details plus a yellow fallback notice.

## See also

- `pan conv current` (alias `pan conv whoami`) — print the conversation you are running inside; the deterministic answer to "which conversation am I?".
- `pan fork [conv]` — create a summary or plain fork without asking the source agent to author a handoff; also self-detects when `<conv>` is omitted.
- `/pan-workflow` — broader Overdeck workflow guidance.
