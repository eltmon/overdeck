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

You have access to TLDR MCP tools for catching up on partial work without re-reading whole files:
- `tldr_context <file>` — summarize in-flight files before editing them again
- `tldr_structure <directory>` — rebuild your mental model of the touched subsystem
- `tldr_semantic <query>` — locate code related to the resume instructions or feedback
- `tldr_calls <function> <file>` — find callers before changing a resumed implementation
- `tldr_impact <function> <file>` — understand downstream effects before continuing

Use TLDR first to regain context quickly, then use full Reads only for exact code you need to edit or verify.

{{/TLDR_AVAILABLE}}
## What To Do Now

{{INSTRUCTIONS_BLOCK}}
