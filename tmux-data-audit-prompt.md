# Audit Prompt: Distinct Data Captured from tmux Scrollback

## Objective
Map every piece of distinct data that consumers currently extract from tmux pane scrollback via `capturePaneAsync()`. This data will be used to design a structured replacement storage system so tmux scrollback capture can be eliminated entirely.

## Instructions

1. **Find all `capturePaneAsync` call sites** in `src/` (dashboard server, lib, CLI, etc.)
2. **For each call site, identify:**
   - File and function/line number
   - What regex patterns or string parsing is applied to the captured output
   - What distinct data fields are extracted (e.g., `REVIEW_RESULT`, `FILES_REVIEWED`, heartbeat timestamps, "thinking..." loop detection, merge status markers, etc.)
   - Whether the data is used for display, logic/branching, or both
   - The data's lifetime: ephemeral (real-time only) or persistent (written to DB/files)

3. **Also check these related patterns that may read tmux output indirectly:**
   - `getLatestAgentOutput()`
   - `getAgentTranscript()`
   - `tmuxExecAsync('capture-pane')`
   - Any direct `tmux capture-pane` shell execs

4. **Categorize findings by consumer domain:**
   - Review agents (parseAgentOutput, status markers)
   - Merge agents (merge result detection)
   - Health/stuck detection (deacon, "thinking..." loops)
   - Dashboard UI (mission control, transcripts, activity view)
   - Workspaces (terminal preview)
   - Conversations (panel preview)

5. **For each distinct data field found, specify:**
   - Field name / semantic meaning
   - Format when in tmux (free text, marker prefix, JSON, etc.)
   - Who produces it (which agent/system writes it to tmux)
   - Who consumes it (which function reads it)
   - Whether it needs to be: (a) queryable/structured, (b) streamable in real-time, (c) historically archived

## Output Format
Return a structured markdown report with:
- Summary table: `Field | Producer | Consumers | Structured? | Stream? | Archive?`
- Per-consumer breakdown with code references (file:line)
- List of regex patterns / parsing logic currently used
- Recommendations for which fields belong in SQLite vs event stream vs agent state JSON

## Constraints
- Do NOT propose code changes or refactorings
- Do NOT evaluate the design quality — just document what exists
- Focus on data requirements, not implementation elegance
- Include exact file paths and line numbers for every finding
