---
name: resume-work
description: Resume-prompt — context-rich restart message for stopped work agents.
requires:
  - ISSUE_ID
  - INSTRUCTIONS_BLOCK
optional:
  - STOPPED_DURATION
  - USER_MESSAGE
  - PENDING_FEEDBACK_BLOCK
  - STATE_STATUS
  - CURRENT_PHASE
  - REMAINING_WORK_BLOCK
  - NO_STATE_BLOCK
  - TLDR_AVAILABLE
---
# Agent Resumed — {{ISSUE_ID}}

You have been **resumed** from a previous session. Your full conversation history is intact.
{{#STOPPED_DURATION}}You were stopped for approximately **{{STOPPED_DURATION}}**.
{{/STOPPED_DURATION}}
{{#USER_MESSAGE}}
## Operator Message

{{USER_MESSAGE}}
{{/USER_MESSAGE}}
{{#PENDING_FEEDBACK_BLOCK}}
{{PENDING_FEEDBACK_BLOCK}}
{{/PENDING_FEEDBACK_BLOCK}}
{{#STATE_STATUS}}
## Last Known Status: {{STATE_STATUS}}
{{/STATE_STATUS}}
{{#CURRENT_PHASE}}
## Where You Left Off

{{CURRENT_PHASE}}
{{/CURRENT_PHASE}}
{{#REMAINING_WORK_BLOCK}}
{{REMAINING_WORK_BLOCK}}
{{/REMAINING_WORK_BLOCK}}
{{#NO_STATE_BLOCK}}
{{NO_STATE_BLOCK}}
{{/NO_STATE_BLOCK}}
{{#TLDR_AVAILABLE}}
## TLDR: Fast Re-Orientation

TLDR is wired in as a PreToolUse hook on `Read`, not as MCP tools: reading a
large code file automatically returns a structured summary (~1k tokens instead
of 10-25k) whenever the file's own checkout has `.venv/bin/tldr`. You don't
need to invoke anything. To see full contents anyway, Read with offset/limit;
recently-edited files always return full content so you can verify your changes.

For deliberate exploration, use the CLI via Bash from the checkout root:
`.venv/bin/tldr context <module-path> --lang <lang>` for structure/exports, or
`.venv/bin/tldr extract <file>` for structured JSON. Do NOT call `tldr_*` MCP
tools (`tldr_context`, `tldr_semantic`, ...) — they are not registered in agent
sessions and will not exist in your toolset (PAN-3534).
{{/TLDR_AVAILABLE}}
## What To Do Now

{{INSTRUCTIONS_BLOCK}}
