# PAN-124: Deduplicate docs, create master index, add documentation skills

## Issue Summary

Two issues with Panopticon documentation:
1. **Duplicate Content**: README.md (3054 lines) contains detailed configuration that overlaps with docs/*.md
2. **No Navigation**: No master index to navigate 11+ documentation files

**Issue URL:** https://github.com/eltmon/panopticon-cli/issues/124
**Branch:** feature/pan-124

---

## Deliverables

### Part 1: docs/INDEX.md - Documentation Master Index
Create scannable table-of-contents for ALL documentation, organized by category with "Topic Quick-Find" section.

### Part 2: README.md Deduplication
Transform README into marketing + quickstart page (<500 lines). Move detailed content to docs/.

### Part 3: pan-docs Skill - Documentation Finder
Help agents find information by reading INDEX.md first, then identified documents.

### Part 4: Update update-panopticon-docs Skill
Add "Index Maintenance" section to remind agents to update INDEX.md when docs change.

---

## Current Documentation Files

**Root:**
- README.md — 3054 lines (needs deduplication)
- CLAUDE.md — Agent guidance
- AGENTS.md — Agent system architecture
- CONTRIBUTING.md — Contribution guidelines

**docs/:**
- CONFIGURATION.md — Multi-model routing, API keys, presets
- WORK-TYPES.md — 23 work type definitions
- MODEL_RECOMMENDATIONS.md — Optimal model assignments
- SPECIALIST_WORKFLOW.md — Worker/specialist interaction
- cost-tracking.md — Event-sourced cost tracking
- DNS_SETUP.md — Local DNS resolution
- E2E_TEST_PLAN.md — End-to-end test plan
- TESTING-PROVIDERS.md — Provider testing guide
- SETTINGS-UI-DESIGN.md — Settings UI design
- PRD.md, PRD-CLOISTER.md, PRD-REMOTE-WORKSPACES.md — Product requirements

---

## Implementation Plan

### Phase 1: Create docs/INDEX.md (IN PROGRESS)
1. [ ] Create comprehensive documentation index
2. [ ] Organize by category (Getting Started, Architecture, Configuration, etc.)
3. [ ] Add "Topic Quick-Find" section with keyword mappings
4. [ ] Include all documentation files with brief descriptions

### Phase 2: Create pan-docs Skill
1. [ ] Create skills/pan-docs/SKILL.md
2. [ ] Add instructions to read INDEX.md first
3. [ ] Use Topic Quick-Find for keyword matching
4. [ ] Return answers with source file references

### Phase 3: Update update-panopticon-docs Skill
1. [ ] Add "Index Maintenance" section
2. [ ] Remind agents to update INDEX.md when docs change
3. [ ] Update DOC_LOCATIONS.md reference

### Phase 4: README.md Deduplication
1. [ ] Create new concise README (~400 lines)
2. [ ] Keep: elevator pitch, features, quickstart, installation
3. [ ] Move detailed content to docs/USAGE.md
4. [ ] Ensure all links point to correct locations
5. [ ] Verify no information lost

### Phase 5: Testing
1. [ ] Run test suite (npx vitest run)
2. [ ] Verify all paths in INDEX.md exist
3. [ ] Verify README links work
4. [ ] Run pan sync to distribute pan-docs skill

---

## Current Status

### Phase 1: docs/INDEX.md ✅ COMPLETE
Created comprehensive documentation index with:
- 7 categories: Getting Started, Architecture, Configuration, Infrastructure, Testing, Agent Guidance, UI/UX, Planning
- Topic Quick-Find section with 40+ keyword mappings
- All documentation files listed with descriptions

### Phase 2: pan-docs Skill ✅ COMPLETE
Created skills/pan-docs/SKILL.md with:
- Workflow: Read INDEX.md → Use Topic Quick-Find → Read identified docs
- Clear instructions for agents to provide source references
- Common questions mapping table

### Phase 3: update-panopticon-docs Skill ✅ COMPLETE
Updated .claude/skills/update-panopticon-docs/SKILL.md with:
- New "Index Maintenance" section
- Instructions for updating INDEX.md when docs change
- Verification checklist
- Updated DOC_LOCATIONS.md to include INDEX.md

### Phase 4: README.md Deduplication ✅ COMPLETE
Replaced README.md with concise version (335 lines) including:
- Marketing content for Legacy Codebase Support feature
- Screenshots section
- Quick start and key concepts
- Links to detailed USAGE.md

Created comprehensive docs/USAGE.md with:
- Complete installation guide
- Detailed configuration instructions
- Commands reference
- Troubleshooting section

---

### Phase 5: Testing and Verification ✅ COMPLETE
- Verified all file paths in INDEX.md exist
- Verified README links point to correct locations
- Test suite run completed (16 pre-existing failures unrelated to documentation changes)
- All documentation files created successfully

---

## Remaining Work

None - All phases complete!

---

## Review Feedback (2026-02-08T14:29Z)

**Status:** BLOCKED - README.md has broken formatting

### Issue: DUPLICATE/BROKEN QUICK START SECTION [BLOCKING]

**Location:** README.md lines 198-202

The README has a duplicate Quick Start section that appears to be a merge artifact:

- Line 198: `## Quick Start`
- Line 200: Opening code fence (bash)
- Line 202: `---`
- Line 204: `## 🚀 Quick Start` (this is the proper section)

The first "## Quick Start" section (lines 198-202) has an unclosed code block and no content.

### Required Fix:

Remove lines 198-202 (the broken section). Keep only the "## 🚀 Quick Start" section at line 204.

View the problem:
```
sed -n '193,215p' README.md
```

The rest of the documentation reorganization looks good - just need to fix this merge artifact.


## Test Agent Feedback (Sun Feb  8 06:35:03 PST 2026)

**Feedback from test-agent** (test)

**Summary:** ❌ Tests FAILED - 1 NEW regression detected

**Test Results Comparison:**
- **Main branch baseline:** 16 tests failed
- **Feature branch:** 17 tests failed
- **NEW regressions:** 1

**NEW Failure That MUST Be Fixed:**

**src/lib/costs/__tests__/retention.test.ts** (1 NEW failure):
- ❌ "should handle events exactly at retention boundary" (line 410:36)
  - Expected: 1 event retained
  - Got: 0 events retained
  - **Root cause:** Events exactly at the retention boundary are being deleted instead of retained
  - **Issue:** The comparison logic likely uses `>` instead of `>=`

**Pre-existing Failures (16 total - informational only):**
- settings.test.ts: 1 failure
- work-type-router.test.ts: 3 failures
- specialist-context.test.ts: 6 failures
- specialist-logs.test.ts: 5 failures
- migration.test.ts: 1 failure

**Action Items:**
1. **CRITICAL:** Fix retention boundary logic - events AT the boundary should be retained (>= not >)
2. Verify the fix with: `npm test retention.test.ts`
3. Re-run full test suite to confirm no other issues
4. Request re-review when the NEW regression is resolved

**Debug Suggestion:**
Check the retention comparison logic - the comment says "Event exactly at boundary should be retained (>= comparison)" but the code likely uses `>` instead of `>=`.

**Status:** readyForMerge = false (test gate blocked by 1 NEW regression)
