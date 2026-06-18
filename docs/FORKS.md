# Conversation Forks

Panopticon lets you fork any conversation to create a new session that continues the work. Forking is useful when:

- A conversation is running out of context window
- You want to switch models mid-task
- You want to experiment with a different approach while keeping the original
- You want to split a multi-topic conversation into focused threads

## Fork Modes

### Summary Fork (Default)

A **summary fork** distills the conversation history into a structured summary and injects it as the first message in the new session.

**What happens:**
1. Panopticon reads the entire JSONL history (from the last compact boundary, if any)
2. A summary model (configurable, default: Sonnet 4.6) generates a structured checkpoint covering goals, progress, decisions, and next steps
3. The new conversation spawns with the summary as its initial context
4. The model acknowledges the summary and waits for your next instruction

**Advantages:**
- Works across any model or provider switch (Kimi → Opus, Anthropic → OpenAI, etc.)
- Drops irrelevant noise and tool call churn
- Typically much smaller token footprint than raw history
- No risk of provider-specific block validation errors

**Disadvantages:**
- Costs extra tokens for summary generation
- Loses verbatim message history (the model can't reference exact prior turns)
- Very large conversations may require chunked incremental summarization (handled automatically)

### Plain Fork

A **plain fork** copies the raw JSONL history (from the last compact boundary) into a new session file and resumes it with `--resume`.

**What happens:**
1. Panopticon copies JSONL entries from the last `compact_boundary` forward
2. Thinking blocks are sanitized: `thinking` blocks with signatures are converted to plain `text` blocks to prevent cross-model API errors
3. The new conversation spawns with `claude --resume <sessionId>`
4. Claude Code loads the full raw transcript directly

**Advantages:**
- Preserves exact message history, tool calls, and reasoning chain
- No summary generation cost
- The model sees its own prior turns authentically

**Disadvantages:**
- Carries the full token weight of the history
- Cross-model forks may still fail if the history contains provider-specific tool schemas or other non-portable blocks
- Less practical for very long conversations

### Handoff (agent-authored)

A **handoff fork** asks the live source agent to write the seed text itself, then starts the new conversation from that authored handoff document.

**What happens:**
1. Panopticon creates a handoff document path under `${OVERDECK_HOME}/handoffs/` using the source conversation id and timestamp, for example `${OVERDECK_HOME}/handoffs/<source-conv-id>-<iso-ts>.md`.
2. Panopticon renders the inlined prompt template from `roles/handoff.md`, substituting the optional `--focus` text and the exact output path.
3. The prompt is delivered to the source conversation through `deliverAgentMessage()` so Channels and tmux fallback use the same message-delivery primitive as normal agent communication.
4. The source agent writes the Markdown handoff document and then creates the sibling sentinel file `<source-conv-id>-<iso-ts>.md.done` only after the document is complete.
5. Panopticon polls asynchronously for both the document and sentinel, validates the document, and injects the document text into the target conversation as the first message.

**Document contract:**
- The document must be at least 200 characters after trimming.
- It must include an H2 `## Suggested skills` section.
- It should reference artifacts by stable path, issue, commit, log, screenshot, or URL rather than copying large source material into the handoff.
- It must redact secrets and sensitive data such as API keys, passwords, tokens, cookies, private keys, and PII.

**Focus:**
- `pan handoff <conversation> --focus "..."` and the dashboard Focus field tell the source agent what the successor most needs to know.
- If no focus is provided, the prompt tells the agent to write a general continuation handoff.

**Timeout and fallback:**
- The default handshake timeout is 5 minutes (`300_000ms`).
- Timeout, validation failure, source-ended state, or source-in-workspace-devcontainer detection automatically falls back to a summary fork.
- Fallback keeps the command useful: the target conversation still starts, but its title is `Summary Fork: ...` instead of `Handoff: ...`.

**Caveats:**
- Workspace devcontainer sources cannot write to the host `${OVERDECK_HOME}/handoffs/` in v1, so Panopticon falls back to summary fork when the source cwd is a workspace path and that workspace stack is up.
- Handoff seed text is portable Markdown, so Pi targets consume it the same way they consume summary forks. Plain forks remain Claude-Code-only because Pi cannot resume Claude JSONL history.

Implementation lives in `src/lib/conversations/summary-fork.ts`; the authoring prompt template lives in `roles/handoff.md`.

## Fork Options

When forking from the dashboard, you can configure:

| Option | Default | Description |
|--------|---------|-------------|
| **Plain fork** | Off | Copy raw history instead of generating a summary |
| **Handoff fork** | Off | Ask the live source agent to author the seed document |
| **Focus** | Empty | Optional guidance for what the source agent should emphasize in a handoff |
| **Fast summary (no LLM)** | Off | Use a heuristic fallback instead of calling an LLM to summarize. Faster and free, but less nuanced |
| **Include thinking in summary** | Off | When generating a summary, include thinking block content as labeled text. Increases summary size but preserves reasoning details |
| **Summary model** | Configured compaction model | Which model generates the summary. Only applies when Fast summary is off |
| **Launch model** | Source conversation's model | Which model the new forked conversation uses |

### Thinking Block Behavior

Thinking blocks are handled differently depending on fork mode:

**Summary fork:**
- Thinking blocks are stripped from the serialized conversation sent to the summary model by default
- If **Include thinking in summary** is enabled, thinking content is included as `[thinking]: ...` text in the summary
- The new conversation never receives signed thinking blocks — only plain text

**Plain fork:**
- Thinking blocks are sanitized during copy: `type: "thinking"` blocks are converted to `type: "text"` blocks with a `[Thinking]` prefix
- This prevents `Invalid signature in thinking block` errors when resuming cross-model

## What Gets Preserved

| Property | Preserved? | Notes |
|----------|-----------|-------|
| Issue ID | Yes | New conversation is linked to the same issue |
| Working directory (`cwd`) | Yes | Defaults to source conversation's cwd |
| Effort level | Yes | Inherited from source |
| Model | Configurable | Defaults to source model, overrideable at fork time |
| Message history | Mode-dependent | Summary fork: distilled; Plain fork: copied raw |

## Model Switching

Switching models when forking is common, but comes with caveats:

- **Summary fork + model switch:** Safe. The summary is plain text, portable to any model.
- **Plain fork + same model:** Safe. Raw history loads directly.
- **Plain fork + different model:** Risky. Even with thinking sanitization, tool schemas and other provider-specific metadata may cause issues. The dashboard shows a warning when you select a different launch model with plain fork enabled.

## Token & Cost Implications

**Summary fork costs:**
- Summary generation: proportional to conversation length. Chunked for large conversations.
- The summary model's rate applies (default: Sonnet 4.6 at $15/1M input tokens)

**Plain fork costs:**
- No generation cost
- But the new conversation starts with the full history token count, so the first turn costs more

**Fast summary costs:**
- Zero LLM cost
- Parses JSONL locally and extracts user messages, files modified, and tools used

## Handoff Prompt Template

Agent-authored handoff forks use the orchestrator-injected template in `roles/handoff.md`. The template defines the Markdown handoff contract, including the required `## Suggested skills` section, artifact-reference rules, redaction requirements, and the `{{outputPath}}` plus `.done` sentinel completion protocol.

## Developer Notes

See `src/lib/conversations/summary-fork.ts` for the fork pipeline implementation.

Key functions:
- `createSummaryFork()` — entry point, orchestrates session reservation and seed generation
- `requestHandoffFromAgent()` — live-agent handoff prompt delivery, doc/sentinel polling, and validation
- `validateHandoffDoc()` — handoff document contract check
- `generateSummaryForFork()` — calls the LLM summarizer with fork-specific settings
- `generateFallbackSummary()` — heuristic summary when LLM is unavailable
- `copySessionFromCompactBoundary()` — raw JSONL copy with thinking sanitization for plain fork
