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
## What To Do Now

{{INSTRUCTIONS_BLOCK}}
