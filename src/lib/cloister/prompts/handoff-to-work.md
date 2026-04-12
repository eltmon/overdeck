---
name: handoff-to-work
description: Handoff prompt — passed to a new agent taking over work from a previous model.
requires:
  - ISSUE_ID
  - PREVIOUS_MODEL
  - REASON
  - HANDOFF_CONTEXT
optional:
  - ADDITIONAL_INSTRUCTIONS_BLOCK
---
# Agent Handoff

You are taking over work on issue {{ISSUE_ID}} from a {{PREVIOUS_MODEL}} agent.

**Handoff Reason:** {{REASON}}

Please review the context below and continue the work.

---

{{HANDOFF_CONTEXT}}
{{#ADDITIONAL_INSTRUCTIONS_BLOCK}}
---

## Additional Instructions

{{ADDITIONAL_INSTRUCTIONS_BLOCK}}
{{/ADDITIONAL_INSTRUCTIONS_BLOCK}}
