# Planning Session: PAN-203

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - PRD file at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-203
- **Title:** PAN-203: Support WebVTT (.vtt) file uploads for transcripts
- **URL:** https://github.com/eltmon/panopticon-cli/issues/203

## Description
## Summary

The Mission Control transcript upload feature currently only accepts `.md` and `.txt` files. We should also support **WebVTT (.vtt)** files, which are the standard export format from Zoom, Teams, YouTube, Google Meet, and most other video/meeting platforms.

When a user uploads a `.vtt` file, it should be automatically converted to readable Markdown before being stored.

## Background: What is WebVTT?

WebVTT (Web Video Text Tracks) is a W3C standard for timed text. A typical file looks like:

```
WEBVTT

NOTE This is a comment block, should be ignored

00:00:01.000 --> 00:00:04.500
Welcome to the meeting everyone.

00:00:05.200 --> 00:00:09.800
<v Alice>Let's start with the status update.

00:00:10.000 --> 00:00:15.300
<v Bob>The API work is done, we're waiting on frontend.
```

Key elements:
- **Header line**: Always starts with `WEBVTT` (optionally followed by metadata)
- **NOTE blocks**: Comment blocks that start with `NOTE` — should be skipped
- **Cue timestamps**: `HH:MM:SS.mmm --> HH:MM:SS.mmm` (hours may be omitted: `MM:SS.mmm`)
- **Speaker tags**: `<v SpeakerName>text` — optional, not all VTT files have them
- **Cue IDs**: Optional numeric or string IDs on the line before timestamps — should be skipped
- **Positioning/styling**: Things like `align:start position:10%` after timestamps — should be stripped
- **Empty lines**: Separate cues from each other

Reference: https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API

## Expected Output

The converted Markdown should look like this:

**With speakers:**
```markdown
# Transcript

**[00:01]** **Alice:** Let's start with the status update.

**[00:10]** **Bob:** The API work is done, we're waiting on frontend.
```

**Without speakers:**
```markdown
# Transcript

**[00:01]** Welcome to the meeting everyone.

**[00:05]** Let's start with the status update.
```

Timestamps should be simplified to `MM:SS` (drop milliseconds and leading zero hours).

## Implementation Plan

### Step 1: Add VTT parser utility

**Create:** `src/dashboard/server/utils/vtt-parser.ts`

This module exports a single function:

```typescript
export function vttToMarkdown(vttContent: string): string
```

**Parsing logic:**

1. Validate the file starts with `WEBVTT` (after trimming). If not, return the content as-is (treat as plain text).
2. Split content into blocks separated by empty lines.
3. Skip the header block (first block starting with `WEBVTT`).
4. Skip any block starting with `NOTE`.
5. For each remaining block (a "cue"):
   a. Look for a line matching the timestamp pattern: `/(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/`
   b. Skip any line before the timestamp (that's the optional cue ID).
   c. Strip positioning metadata after the end timestamp (anything after the second timestamp on the same line).
   d. Collect all lines after the timestamp as the cue text.
   e. Extract speaker from `<v SpeakerName>` tag if present, and strip the tag from the text.
   f. Format the start timestamp as `MM:SS` (e.g., `00:01:23.456` → `01:23`).
6. Build markdown output:
   - Start with `# Transcript\n\n`
   - For each cue: `**[MM:SS]** **Speaker:** Text\n\n` (or without speaker if none)
7. Collapse consecutive cues from the same speaker within 3 seconds into a single block (optional nice-to-have, not required for v1).

**Edge cases to handle:**
- Multi-line cue text (join with space)
- HTML tags in cue text like `<b>`, `<i>`, `<u>` — strip them
- `&amp;`, `&lt;`, `&gt;` entities — decode them
- Empty cues — skip
- Windows line endings (`\r\n`) — normalize to `\n`
- Files that are not actually VTT despite `.vtt` extension — return as-is

### Step 2: Update the upload endpoint

**File:** `src/dashboard/server/index.ts`

In the `POST /api/mission-control/planning/:issueId/upload` handler (around line 12196):

After receiving the content and before writing to disk, check if the filename ends with `.vtt`:

```typescript
let finalContent = content;
let finalFilename = safeName;

if (safeName.endsWith('.vtt')) {
  const { vttToMarkdown } = await import('../utils/vtt-parser.js');
  finalContent = vttToMarkdown(content);
  finalFilename = safeName.replace(/\.vtt$/, '.md');
}
```

Use `finalContent` and `finalFilename` for the file write. This way VTT files are stored as `.md` after conversion.

### Step 3: Update frontend file validation

**File:** `src/dashboard/frontend/src/components/MissionControl/FeatureMetadata/TranscriptUpload.tsx`

On line 18, change:
```typescript
if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
  setUploadResult('Only .md and .txt files are supported');
```

To:
```typescript
if (!file.name.endsWith('.md') && !file.name.endsWith('.txt') && !file.name.endsWith('.vtt')) {
  setUploadResult('Only .md, .txt, and .vtt files are supported');
```

Also update any drag-and-drop hint text or `accept` attributes to include `.vtt`.

### Step 4: Write tests

**Create:** `tests/dashboard/utils/vtt-parser.test.ts`

Test cases to cover:

1. **Basic VTT with timestamps only** — no speakers, simple cues
2. **VTT with speaker tags** — `<v Name>` format
3. **Multi-line cues** — text spanning multiple lines within a cue
4. **NOTE blocks** — should be stripped
5. **Cue IDs** — numeric IDs before timestamps should be ignored
6. **Positioning metadata** — `align:start` etc. after timestamps should be stripped
7. **HTML tags in text** — `<b>`, `<i>` should be stripped
8. **HTML entities** — `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`
9. **Empty/malformed file** — returns content as-is
10. **Not a VTT file** — content without `WEBVTT` header returns as-is
11. **Windows line endings** — `\r\n` handled correctly
12. **Timestamp formatting** — `01:23:45.678` → `23:45`, `00:05.200` → `00:05`
13. **Empty cues** — skipped gracefully
14. **Real-world Zoom export** — use a realistic sample

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/dashboard/server/utils/vtt-parser.ts` | **Create** | VTT-to-Markdown converter |
| `tests/dashboard/utils/vtt-parser.test.ts` | **Create** | Unit tests for parser |
| `src/dashboard/server/index.ts` | **Modify** | Add VTT detection in upload handler (~line 12196) |
| `src/dashboard/frontend/src/components/MissionControl/FeatureMetadata/TranscriptUpload.tsx` | **Modify** | Accept `.vtt` in file validation (line 18) |

## Sample VTT for Testing

```
WEBVTT
Kind: captions
Language: en

NOTE
Created by Zoom

1
00:00:01.000 --> 00:00:04.500 align:start position:10%
Welcome to the sprint planning meeting.

2
00:00:05.200 --> 00:00:09.800
<v Alice Chen>OK let's start with the backlog items.

3
00:00:10.000 --> 00:00:15.300
<v Bob Smith>I've got three stories ready for estimation.
They're all in the &quot;Ready&quot; column.

4
00:00:16.000 --> 00:00:18.500
<v Alice Chen>Great, let's go through them one by one.
```

Expected output:
```markdown
# Transcript

**[00:01]** Welcome to the sprint planning meeting.

**[00:05]** **Alice Chen:** OK let's start with the backlog items.

**[00:10]** **Bob Smith:** I've got three stories ready for estimation. They're all in the "Ready" column.

**[00:16]** **Alice Chen:** Great, let's go through them one by one.
```

## Acceptance Criteria

- [ ] `.vtt` files can be uploaded via the transcript upload UI
- [ ] VTT content is converted to readable Markdown on upload
- [ ] Converted files are stored as `.md` (not `.vtt`)
- [ ] Speaker names are extracted and formatted when present
- [ ] Timestamps are human-readable (`MM:SS`)
- [ ] NOTE blocks, cue IDs, positioning metadata, and HTML tags are stripped
- [ ] Invalid/non-VTT files with `.vtt` extension are handled gracefully
- [ ] All test cases pass
- [ ] No new dependencies added (pure string parsing)

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

When creating beads tasks, include difficulty labels:
```bash
bd create "PAN-XX: Task name" --type task -l "PAN-XX,linear,difficulty:medium" -d "Description"
```

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to PRD at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the PRD file BEFORE creating beads tasks.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
