// Summarization prompts shared by smart compaction, fork summaries and the E4
// summary-faithfulness eval. Leaf module: no imports, so evals and src/ can both use it.

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

export const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export const TURN_PREFIX_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

// ============================================================================
// Rich summarization prompts (9-section format, more verbose)
// ============================================================================

export const RICH_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a comprehensive continuation summary that another LLM will use to continue the work without losing context.

Use this EXACT format:

## Primary Request and Intent
[What is the user trying to accomplish? Include explicit asks, constraints, and intended outcome.]

## Key Technical Concepts
- [Major technical topics, tools, frameworks, libraries, patterns, and architectural ideas]
- [Or "(none)" if none were mentioned]

## Files and Code Sections
- [File name]: [why it matters, what was examined or changed, include important code snippets in full when applicable]
- [Or "(none)" if not applicable]

## Errors and fixes
- [What went wrong and how it was fixed or addressed]
- [Or "(none)" if none occurred]

## Problem Solving
[Problems resolved and any ongoing troubleshooting]

## All user messages
- [Every user message in the conversation that was not a tool result. Do not omit any.]
- [Or "(none)" if not applicable]

## Pending Tasks
- [All unfinished work the user has explicitly asked for]
- [Or "(none)" if not applicable]

## Current Work
[Exactly what was being worked on immediately before this summarization request. Focus on the latest messages.]

## Optional Next Step
[The next action that should be taken, but only if it directly follows from the user's most recent request. Include exact quoted lines where useful.]

Be thorough, specific, and technically accurate. Preserve exact file paths, function names, error messages, and code snippets.`;

export const RICH_UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, user messages, and context from the new messages
- UPDATE the "Current Work" section to reflect the latest state
- UPDATE "Pending Tasks" based on what was completed or newly requested
- PRESERVE exact file paths, function names, error messages, and code snippets
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Primary Request and Intent
[Preserve existing intent, add new ones if the task expanded]

## Key Technical Concepts
- [Preserve existing, add new ones discovered]

## Files and Code Sections
- [Preserve existing files, add new ones, update changed ones with full code snippets]

## Errors and fixes
- [Preserve existing, add new ones, mark resolved if appropriate]

## Problem Solving
[Update with new resolutions and ongoing troubleshooting]

## All user messages
- [Preserve existing user messages, add new ones from the recent conversation]

## Pending Tasks
- [Update based on what was completed or newly requested]

## Current Work
[Update to reflect the latest state immediately before this request]

## Optional Next Step
[Update based on current state]

Be thorough. Preserve exact file paths, function names, error messages, and code snippets.`;

/** The user part of the summary prompt: <conversation>, optional <previous-summary>, instruction. */
export function buildSummaryUserPrompt(serialized: string, previousSummary: string | undefined, richMode: boolean): string {
  const updatePrompt = richMode ? RICH_UPDATE_SUMMARIZATION_PROMPT : UPDATE_SUMMARIZATION_PROMPT;
  const initPrompt = richMode ? RICH_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  const promptText = `<conversation>\n${serialized}\n</conversation>\n\n`;
  return previousSummary
    ? `${promptText}<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${updatePrompt}`
    : `${promptText}${initPrompt}`;
}

/** Exact single prompt generateSummaryFromPrompt sends via claude -p: system text, blank line, user part. */
export function buildSummaryPrompt(serialized: string, previousSummary: string | undefined, richMode: boolean): string {
  return `${SUMMARIZATION_SYSTEM_PROMPT}\n\n${buildSummaryUserPrompt(serialized, previousSummary, richMode)}`;
}

export function buildTurnPrefixPrompt(serialized: string): string {
  return `${SUMMARIZATION_SYSTEM_PROMPT}\n\n<conversation>\n${serialized}\n</conversation>\n\n${TURN_PREFIX_PROMPT}`;
}
