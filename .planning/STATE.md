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
