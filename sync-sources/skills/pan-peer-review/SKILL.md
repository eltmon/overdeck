---
name: pan-peer-review
description: "Workflow: spawn an independent adversarial reviewer on a different model to verify or refute your own findings. EXPENSIVE — invoke only when the operator explicitly asks for a peer/second-opinion review."
triggers:
  - peer review my findings
  - get independent feedback
  - second opinion from another model
  - have another model review this
  - adversarial review of my analysis
allowed-tools:
  - Bash
  - Read
  - Write
---

# pan peer-review — independent second opinion from another model

Spawn a conversation on a **different model family** to adversarially verify or
refute an analysis you produced, then read its findings back. Use it when a
conclusion is expensive to get wrong: a root-cause diagnosis about to become a
PRD, a refactor plan, a security claim, a "this is safe to merge" call.

## ⚠️ Operator-invoked only — never launch this on your own initiative

**Do not start a peer review because you think your work would benefit from
one.** A peer review spawns a second full agent that reads source, burns a
frontier-model context, and runs for many minutes. That cost is the operator's
call, not yours.

Launch only when the operator explicitly asks — "get a second opinion", "run
this by another model", "have K3 review it", "peer review this". If you believe
a review is warranted and they have not asked, say so in one sentence and let
them decide.

Corollary: never chain reviews. One reviewer, one pass. If the reviewer
disagrees with you, bring the disagreement back to the operator rather than
spawning a third model to break the tie.

## Why a different model, and what "independent" buys you

A reviewer on the same model as the author tends to agree — it reconstructs the
same reasoning from the same priors. The value comes from a different family
reading the same source: Opus/Fable reviewing GPT work, K3 reviewing Claude
work, GPT reviewing Claude work.

Pick the reviewer by contrast with whoever produced the analysis:

| Author | Good reviewer |
| --- | --- |
| Claude (Opus/Fable/Sonnet) | `k3` (Kimi), `gpt-5.6-sol` |
| GPT | `claude-opus-5`, `k3` |
| Kimi | `claude-opus-5`, `gpt-5.6-sol` |

Never pass `--harness`. Harness routing is config-owned and the operator sets it
deliberately; `--model` is the only routing flag this workflow uses, and only
because the operator asked for a specific reviewer.

Leave reasoning effort alone. It inherits `high`, which is the right tier —
never raise it to `xhigh`/`max` for a review.

## The workflow

### 1. Write the brief to a file — never into the focus

The `pan handoff` focus is for steering, not content (hard ceiling 10,000 chars
since PAN-3737). A real review brief is thousands of characters of structure —
write it to a file in the reviewer's future cwd and let the focus point at it.

A brief that produces a useful review has these parts:

- **Adversarial framing, stated first.** "Assume each claim may be wrong. A
  claim that survives refutation is worth more than agreement. Do not soften
  findings to be agreeable." Without this you get a politeness echo.
- **Read-only rules.** No edits to source, no commits, no `pan` commands, no
  POST/DELETE. The reviewer writes exactly one file: its findings.
- **A glossary** of every term of art before you use it — the reviewer has none
  of your conversation's context.
- **Absolute paths for evidence outside the worktree** — live workspaces, logs,
  config, API endpoints. The reviewer cannot find them otherwise.
- **Each claim stated separately**, with the exact file:line it rests on, the
  evidence you used, and the fix you propose.
- **Per-claim questions that invite refutation** — "does the fix actually
  terminate the loop?", "what is the blast radius?", "would this regress the
  monorepo path?". Generic "please review" produces generic output.
- **Cross-cutting questions**, including at least one that asks for things you
  did *not* find: "search for every other site with this pattern and report any
  beyond the ones named here."
- **An explicit output contract** — a verdict vocabulary (CONFIRMED /
  PARTIALLY CONFIRMED / REFUTED / CANNOT VERIFY), where to write findings, and
  a request to also summarize in-conversation.

### 2. Create a detached worktree

The reviewer needs the source, isolated from your working tree. Spawned agents
must never get the primary worktree as their cwd.

```bash
git worktree add --detach /home/eltmon/Projects/hoff-<slug> main
```

`--detach` is required: a plain `git worktree add <path> main` fails with
`fatal: 'main' is already used by worktree at ...` whenever main is checked out
somewhere, which on a dev machine is always. Detached HEAD is correct here —
the reviewer never commits.

Then write the brief into that worktree.

### 3. Launch the handoff

```bash
pan handoff --model <reviewer-model> --cwd /home/eltmon/Projects/hoff-<slug> self \
  "Read REVIEW-BRIEF.md in your cwd FIRST and follow it exactly. You are an INDEPENDENT ADVERSARIAL reviewer — verify or refute each claim against real source and critique each proposed fix. Read-only. Write findings to FEEDBACK-<model>.md."
```

`self` must come before the focus text. Omitting it makes the CLI read your
focus as a conversation name and fail with `Conversation not found`.

**The command can exceed a two-minute tool timeout while the handoff document is
authored — that is normal and does not mean it failed.** Either run it with
`run_in_background: true`, or let it time out and verify the spawn afterwards:

```bash
tmux -L overdeck list-sessions | grep conv-
```

### 4. Correct the frame — the step everyone skips

`pan handoff` seeds the new conversation with an **authored handoff document
describing your session's state and open work**. It does not deliver your focus
as an instruction. The reviewer therefore wakes up believing it is *you,
continuing your work* — and if your open-work list said "launch a peer review",
it will try to launch one, recursively.

Check what it actually received before assuming it is reviewing:

```bash
tmux -L overdeck capture-pane -t <conv-id> -p -S -30
```

If it is acting as a continuation rather than as a reviewer, correct it with
`pan tell` (never raw tmux keystroke injection):

```bash
pan tell <conv-id> "STOP. You are NOT continuing that conversation's work. You ARE the independent reviewer it wanted to spawn. Read <brief path> and follow it exactly. Read-only. Begin now."
```

Budget for this step every time. Treat the handoff document as context the
reviewer happens to have, and your `pan tell` as the actual task assignment.

### 5. Wait on the artifact, not the pane

Poll for the findings file rather than watching output scroll:

```bash
until [ -s /home/eltmon/Projects/hoff-<slug>/FEEDBACK-<model>.md ]; do sleep 20; done
```

Run that in the background so you can keep working.

### 6. Read the findings critically, then report

The reviewer is not an oracle. Treat REFUTED verdicts as claims to check, the
same way you asked it to treat yours — a reviewer that misreads a call site can
be confidently wrong. Verify anything that would change what you do next.

Report back to the operator with: what the reviewer confirmed, what it refuted
and whether you agree, what it found that you missed, and where you still
disagree after checking. Never launder its output as consensus.

### 7. Clean up

```bash
git worktree remove /home/eltmon/Projects/hoff-<slug>
```

Keep the findings file if it is going into an issue or PRD — copy it out before
removing the worktree.

## Failure modes and what they mean

| Symptom | Cause | Fix |
| --- | --- | --- |
| `fatal: 'main' is already used by worktree at ...` | `git worktree add` without `--detach` | Add `--detach` |
| `Conversation not found` | Focus text passed without `self` first | `pan handoff ... self "<focus>"` |
| `Focus is N characters — the limit is 500`, no conversation created | Brief crammed into the focus | Put the brief in a file, point the focus at it |
| Handoff command times out at 2 minutes | Handoff document authoring is slow | Normal — verify the spawn with `tmux -L overdeck list-sessions` |
| Reviewer starts doing your open-work list, or tries to spawn its own review | It received the handoff doc, not your focus | `pan tell` it the real task (step 4) |
| Reviewer agrees with everything | Brief lacked adversarial framing, or reviewer shares the author's model family | Rewrite the framing; pick a different family |
| `state.json has no issueId` on `pan tell` | Informational — conversations have no issue | Ignore; the message still delivers |

## Related

- `/pan-handoff` — the underlying command and its full semantics
- `/pan-code-review` — reviewing a *diff*; this skill reviews an *analysis*
- `/pan-tell` — the sanctioned way to message a running conversation
