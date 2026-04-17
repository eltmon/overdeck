---
name: summary-fork
description: Generates a comprehensive continuation summary when forking a conversation.
requires:
  - TRANSCRIPT
optional: []
---
Create a comprehensive continuation summary of the conversation so far. The goal is to preserve enough context that future work can continue without losing the user's intent, technical decisions, or implementation details.

First, include an <analysis> section. Use it to inspect the conversation in chronological order and verify that nothing important is missing. In that analysis, explicitly cover the following for each part of the conversation:

- the user's stated request, goal, or constraint
- the response or actions taken to address it
- important decisions made along the way
- relevant technical concepts, architecture, implementation patterns, and design choices
- concrete details such as:
  - file names
  - full code snippets
  - function signatures
  - file edits and created files
- any errors, failed attempts, blockers, or corrections
- any direct user feedback about mistakes, missing details, or preferred approach

After the analysis, provide a <summary> section with these exact sections and purposes:

1. Primary Request and Intent:
   Describe in detail what the user wanted, including explicit asks, constraints, and intended outcome.

2. Key Technical Concepts:
   List the major technical topics, tools, frameworks, libraries, patterns, and architectural ideas involved.

3. Files and Code Sections:
   Enumerate every relevant file, code region, or artifact that was read, discussed, modified, or created.
   For each one, include:
   - the file name
   - why it matters
   - what was examined or changed
   - important code snippets in full, when applicable

4. Errors and fixes:
   Record each mistake, issue, or failure that occurred.
   For every item, include:
   - what went wrong
   - how it was fixed or addressed
   - any related user correction or feedback

5. Problem Solving:
   Summarize the problems that were resolved, along with any troubleshooting that is still ongoing.

6. All user messages:
   List every user message in the conversation that was not a tool result. Do not omit any.

7. Pending Tasks:
   List all unfinished work the user has explicitly asked for.

8. Current Work:
   Explain exactly what was being worked on immediately before this summarization request.
   Focus especially on the latest user and assistant messages.
   Include relevant file names and code snippets where useful.

9. Optional Next Step:
   Identify the next action that should be taken, but only if it directly follows from the user's most recent request and the work that was in progress.
   If applicable, include exact quoted lines from the most recent conversation to anchor that next step and prevent drift.
   Do not introduce unrelated follow-up work.

Formatting requirements:

Use this structure:

<analysis>
...
</analysis>

<summary>
1. Primary Request and Intent:
   ...

2. Key Technical Concepts:
   - ...

3. Files and Code Sections:
   - ...

4. Errors and fixes:
   - ...

5. Problem Solving:
   ...

6. All user messages:
   - ...

7. Pending Tasks:
   - ...

8. Current Work:
   ...

9. Optional Next Step:
   ...
</summary>

Additional requirements:

- Be thorough, specific, and technically accurate.
- Preserve chronological context where it matters.
- Make the summary detailed enough that another assistant could continue the work immediately.
- Pay special attention to the most recent conversation state.
- If any extra summarization instructions appear elsewhere in the provided context, follow them too.
- If those extra instructions narrow the emphasis, apply that emphasis without removing the required sections above.
- Before finalizing, double-check completeness and technical fidelity.

Transcript:
{{{TRANSCRIPT}}}
