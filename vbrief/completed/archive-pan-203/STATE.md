# PAN-203: Support WebVTT (.vtt) File Uploads for Transcripts

## Status: Implementation Complete

## Current Status

**Implementation completed.** All planned changes have been implemented and tested:

1. ✅ Created `src/dashboard/server/utils/vtt-parser.ts` - VTT to Markdown converter
2. ✅ Created `tests/dashboard/utils/vtt-parser.test.ts` - 15 comprehensive test cases (all passing)
3. ✅ Modified `src/dashboard/server/index.ts` - Integrated VTT conversion into upload endpoint
4. ✅ Modified `TranscriptUpload.tsx` - Updated UI to accept .vtt files

All beads tasks closed. Ready for full test suite run, commit, and push.

## Remaining Work

None. Implementation complete, awaiting final validation.

## Summary

Add WebVTT (.vtt) support to the Mission Control transcript upload feature. VTT files are converted to readable Markdown on upload and stored as `.md` — no new dependencies, pure string parsing.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Speaker consolidation | Include in v1 | Cleaner output for long meetings; modest complexity |
| Storage strategy | Convert-only (`.vtt` → `.md`) | Consistent with `readArtifactDir` filter; simpler |
| HTML entity decoding | All common entities | `&amp; &lt; &gt; &quot; &apos; &nbsp;` — VTT files use these |
| Dependencies | None | Pure regex/string parsing |
| Test data | Spec samples | No real-world VTT files needed |

## Architecture

### New file: `src/dashboard/server/utils/vtt-parser.ts`

Exports `vttToMarkdown(vttContent: string): string`

**Parsing pipeline:**
1. Normalize line endings (`\r\n` → `\n`)
2. Validate `WEBVTT` header — if missing, return content as-is
3. Split into blocks by empty lines
4. Skip header block and `NOTE` blocks
5. For each cue block:
   - Skip optional cue ID line (line before timestamp)
   - Parse timestamp: `/(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*/`
   - Strip positioning metadata after end timestamp
   - Extract speaker from `<v Name>` tag
   - Strip HTML tags (`<b>`, `<i>`, `<u>`, etc.)
   - Decode HTML entities (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&nbsp;`)
   - Join multi-line text with spaces
   - Format start timestamp as `MM:SS`
6. **Speaker consolidation**: Merge consecutive cues from same speaker within 3 seconds — append text with space separator
7. Build output: `# Transcript\n\n` + cues formatted as `**[MM:SS]** **Speaker:** Text\n\n`

### Modified: `src/dashboard/server/index.ts` (~line 12797)

In `POST /api/mission-control/planning/:issueId/upload`:
- After receiving content, check if `safeName` ends with `.vtt`
- If so: convert via `vttToMarkdown()`, change extension to `.md`
- Also update the `ext` logic on line 12814 to recognize `.vtt` as a known extension (so it doesn't double-append `.md`)

### Modified: `TranscriptUpload.tsx`

Three changes:
1. **Line 18**: Add `.vtt` to file validation check
2. **Line 119**: Update hint text to `"Accepts .md, .txt, and .vtt files"`
3. **Line 125**: Update `accept` attribute to `".md,.txt,.vtt"`

### New file: `tests/dashboard/utils/vtt-parser.test.ts`

14 test cases covering: basic VTT, speakers, multi-line cues, NOTE blocks, cue IDs, positioning metadata, HTML tags, HTML entities, empty/malformed files, non-VTT content, Windows line endings, timestamp formatting, empty cues, speaker consolidation, and a realistic Zoom export sample.

## Files to Create/Modify

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `src/dashboard/server/utils/vtt-parser.ts` | Create | ~100 |
| `tests/dashboard/utils/vtt-parser.test.ts` | Create | ~200 |
| `src/dashboard/server/index.ts` | Modify | ~8 lines around L12812-12824 |
| `src/dashboard/frontend/.../TranscriptUpload.tsx` | Modify | 3 lines (L18, L119, L125) |

## Acceptance Criteria

- [ ] `.vtt` files can be uploaded via the transcript upload UI
- [ ] VTT content is converted to readable Markdown on upload
- [ ] Converted files are stored as `.md` (not `.vtt`)
- [ ] Speaker names are extracted and formatted when present
- [ ] Timestamps are human-readable (`MM:SS`)
- [ ] NOTE blocks, cue IDs, positioning metadata, and HTML tags are stripped
- [ ] Consecutive same-speaker cues within 3s are consolidated
- [ ] All common HTML entities decoded
- [ ] Invalid/non-VTT files with `.vtt` extension handled gracefully (returned as-is)
- [ ] All test cases pass
- [ ] No new dependencies added

## Risk Assessment

**Low risk.** This is additive — no existing behavior changes. The VTT parser is a pure function with no side effects. The upload handler modification is a simple conditional wrapper. Frontend change is three lines.

## Specialist Feedback

- **[2026-02-21T04:02Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
  - **Issue:** VTT conversion outside try/catch block - could crash handler without response
  - **Fixed:** Moved VTT conversion inside try block for proper error handling (commit ab4604a)
  - **Status:** Fix committed, pushed, and resubmitted for review
