plan-digest: c4ca40d52fc46621063dccecb846005b156a9ae09db0afb844b2affa115b755c

## blocks-the-design: Non-Claude Flywheel tells can still fail

The proposed `pan tell conv-flywheel` passes target resolution because `conv-` is a qualified prefix (`src/cli/agent-target.ts:174`, `src/lib/agents/identity.ts:49-63`). The Flywheel row is created with **name and tmux session both** `conv-flywheel` (`src/lib/flywheel/actions.ts:218-226`), and its harness can be selected by `--harness` or role configuration (`src/lib/flywheel/actions.ts:109-123`). But `messageAgent()` looks up that target with `getConversationByName(normalizedId.slice(5))`, which asks for `flywheel` (`src/lib/agents/messaging.ts:269-279`). `getConversationByName()` compares `c.name = ?` literally (`src/lib/overdeck/conversations.ts:603-607`), so the lookup misses the Flywheel and delivery defaults to `claude-code` (`src/lib/agents/messaging.ts:628`). For a live tmux-backed Pi/OhMyPi Flywheel, the liveness probe then checks for the wrong runtime and can reject it as a dead conversation at `src/lib/agents/messaging.ts:667-686`. The plan's prompt-only guard and cost tests cannot detect this; replacing the six strings alone does not ensure the escalation reaches every supported Flywheel harness.

Smallest change: include the Flywheel name case in the conversation harness lookup (try the full stored name before the stripped name), and add a delivery-path test for `conv-flywheel` with a non-Claude harness. Keep the role prompt retargeting.

## sharpens-framing: The comment fallback has no next-tick pickup step

W1-W4 preserve the claim that an issue comment is “the durable channel the orchestrator checks on its next tick,” and W8 repeats it in `docs/FLYWHEEL.md`. The Flywheel loop's Phase 1b says to walk in-flight issues and inspect agent health, PR state and checks (`sync-sources/skills/pan-flywheel/SKILL.md:119-138`), but gives no step to read issue comments. I ran `rg -n -i 'comment|--comments' sync-sources/skills/pan-flywheel/SKILL.md`; it returned no matches. A comment is durable, but the planned text promises a pickup mechanism the loop does not specify.

Smallest change: either add an explicit issue-comment read to the Flywheel tick and cover it, or change the four role paragraphs and W8 to say the comment preserves the analysis for later inspection without promising the next tick reads it.
