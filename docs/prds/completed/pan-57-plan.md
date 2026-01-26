# PAN-57 Planning State

## Issue Overview
Create professional documentation website using Mintlify at www.panopticon-cli.com

**Key Deliverables:**
1. High-polish README intro with badges, screenshots, comparison tables
2. 18 new .mdx files organized into CLI, Features, Configuration, Guides, Reference
3. Updated docs.json with full Mintlify navigation structure

## Current State Analysis

### Existing Assets
- **README.md**: 2,859 lines (comprehensive but monolithic)
- **docs.json**: Configured with Mintlify schema, but only references introduction.mdx
- **introduction.mdx**: Basic 33-line placeholder
- **Screenshots**: 5 available in docs/ folder:
  - dashboard-overview.png (444K)
  - planning-session-dialog.png (86K)
  - planning-session-active.png (198K)
  - planning-session-discovery.png (165K)
  - planning-session-output.png (166K)

### README Structure (Key Sections)
- Overview (line 7)
- Features (line 19)
- Legacy Codebase Support (line 33) - **Great marketing content**
- Quick Start (line 159)
- Requirements (line 211)
- Configuration (line 250)
- Google Stitch Integration (line 308)
- Multiple feature sections throughout

### Design Specifications Provided

**Color Scheme:**
- Light: `#FDFDF7` bg, `#0E0E0E` text, `#D4A27F` accent
- Dark: `#09090B` bg, `#E5E7EB` text, `#D4A27F` accent

**Typography:**
- Headings: Serif (Georgia fallback)
- Body: Sans-serif, 1rem/1.65rem line-height
- Monospace: System defaults

**Layout:**
- Max width: 64rem
- Responsive: 3 col → 2 col → 1 col
- Left sidebar nav, right ToC

## Proposed Approach (from Issue)

### Phase 1: High-Polish README Introduction (~250 lines)
Transform README.md top section with:
1. Centered hero with badges (npm, license, Node.js, PRs welcome)
2. Hero screenshot (dashboard-overview.png)
3. "What is Panopticon?" with comparison table
4. Screenshot grid (3 planning workflow images)
5. Feature table with icons
6. Legacy Codebase Support moved UP (marketing value)
7. Concise Quick Start (4 lines)
8. Link to full docs

### Phase 2: Create 18 .mdx Files

```
panopticon/
├── introduction.mdx             # Landing page (enhance existing)
├── quickstart.mdx               # NEW
├── concepts.mdx                 # NEW
├── cli/
│   ├── overview.mdx            # NEW
│   ├── core-commands.mdx       # NEW (pan sync, doctor, up, down)
│   ├── agent-commands.mdx      # NEW (pan work issue/status/tell/kill)
│   ├── workspace-commands.mdx  # NEW (pan workspace create/destroy)
│   └── convoy-commands.mdx     # NEW (pan convoy start/status)
├── features/
│   ├── cloister.mdx            # NEW (AI lifecycle manager)
│   ├── specialists.mdx         # NEW (review/test/merge agents)
│   ├── skills.mdx              # NEW (Universal skills system)
│   ├── workspaces.mdx          # NEW (Git worktree workspaces)
│   └── convoys.mdx             # NEW (Multi-agent orchestration)
├── configuration/
│   ├── projects.mdx            # NEW (Project registry)
│   ├── issue-trackers.mdx      # NEW (Linear, GitHub, GitLab, Rally)
│   └── polyrepo.mdx            # NEW (Polyrepo workspace config)
├── guides/
│   ├── legacy-codebases.mdx    # NEW (Enterprise legacy support)
│   ├── stitch-integration.mdx  # NEW (Google Stitch UI design)
│   └── docker-setup.mdx        # NEW (Docker/Traefik/HTTPS)
└── reference/
    ├── architecture.mdx        # NEW
    └── troubleshooting.mdx     # NEW
```

**Total**: 1 enhanced + 18 new = 19 .mdx files

### Phase 3: Update docs.json
Complete navigation structure with all groups and pages

### Phase 4: Content Migration
Map README sections to target .mdx files (migration table provided in issue)

## Content Migration Map (from Issue Comments)

| README Section | Lines | Target .mdx |
|----------------|-------|-------------|
| Overview | 1-32 | introduction.mdx |
| Legacy Codebase Support | 33-157 | guides/legacy-codebases.mdx |
| Quick Start + Requirements | 159-250 | quickstart.mdx |
| Configuration | 250-307 | configuration/projects.mdx |
| Google Stitch | 308-410 | guides/stitch-integration.mdx |
| Cloister | 411-723 | features/cloister.mdx |
| Model Routing | 725-795 | features/cloister.mdx (subsection) |
| Multi-Project Support | 796-1407 | configuration/polyrepo.mdx |
| Agent Commands | 1500-1542 | cli/agent-commands.mdx |
| Convoys | 1543-1700 | features/convoys.mdx |
| Workspace Management | 1785-1997 | features/workspaces.mdx |
| Dashboard | 2085-2184 | introduction.mdx |
| Skills | 2185-2254 | features/skills.mdx |
| Architecture | 2437-2556 | reference/architecture.mdx |
| Troubleshooting | 2685-2894 | reference/troubleshooting.mdx |

## Technical Requirements

From issue:
- [ ] Set up Mintlify project with custom theme
- [ ] Configure domain (www.panopticon-cli.com)
- [ ] Set up GitHub integration for auto-deploy
- [ ] Add search functionality
- [ ] Configure analytics
- [ ] Add "Edit this page" links to GitHub

## Estimated Effort (from Issue)
- Phase 1 (README polish): 1-2 hours
- Phase 2 (.mdx structure): 1 hour
- Phase 3 (docs.json): 30 minutes
- Phase 4 (content migration): 4-6 hours
**Total**: ~8 hours

## Questions for Discovery

### Scope & Priorities
1. Are we implementing all 4 phases in this issue, or focusing on specific priorities?
2. Should we follow the priority levels from the issue (Priority 1: Launch, Priority 2: Core, Priority 3: Advanced)?
3. Is the README enhancement (Phase 1) included in this scope, or separate?

### Technical Setup
4. Has the Mintlify dashboard been connected to the repo yet (Settings → Git → Select panopticon-cli)?
5. What's the status of domain configuration (www.panopticon-cli.com)?
6. Should we test locally with `npx mintlify dev` before considering this done?

### Content Strategy
7. The issue mentions "dual-purpose documentation" - README stays comprehensive, .mdx files extract/organize. Should we:
   - Keep full content in README AND duplicate in .mdx files?
   - Or trim README to essentials and move deep content to .mdx?
8. Are there any sections to exclude or deprioritize?

### Acceptance Criteria
9. What defines "done" for this issue? All 18 .mdx files created? Site live? Just files ready for review?
10. Do we need to handle the favicon.svg mentioned in docs.json?

## Decisions Made

### Scope
**All 4 phases - complete documentation site**
- Phase 1: High-polish README intro with badges, screenshots, comparison tables
- Phase 2: Create all 18 .mdx files with proper frontmatter and content
- Phase 3: Update docs.json with complete navigation structure
- Phase 4: Migrate content from README to .mdx files

### Content Strategy
**Full migration - duplicate content**
- README stays comprehensive for GitHub visitors (detailed)
- .mdx files have the same detailed content, organized for docs site
- Some duplication is acceptable to serve both audiences well
- Both are maintained as authoritative sources

### Deployment Status
**Already connected to Mintlify**
- Site currently visible at: mindyournow.mintlify.app
- Domain (www.panopticon-cli.com) purchase in progress - NOT in scope
- No need to configure Mintlify dashboard connection
- Just need to create files and verify local dev works

### Definition of Done
Implementation is complete when:
- [ ] All 18 .mdx files created with proper frontmatter and migrated content
- [ ] docs.json fully updated with complete navigation structure
- [ ] `npx mintlify dev` runs without errors
- [ ] All pages render correctly in local dev server
- [ ] All internal links work
- [ ] Screenshots render correctly

## Implementation Plan

### Task Breakdown by Difficulty

#### Phase 1: README Enhancement (difficulty: medium)
**Why medium**: Single file, but requires careful design work with badges, tables, and image layout. Need to preserve existing content while adding polish.

**Tasks:**
1. Add badges row (npm, license, Node.js version, PRs welcome)
2. Insert hero screenshot (dashboard-overview.png)
3. Create comparison table ("Without vs With Panopticon")
4. Add screenshot grid (3 planning workflow images)
5. Create feature table with visual hierarchy
6. Move "Legacy Codebase Support" section UP (currently at line 33)
7. Condense Quick Start to 4 lines with link to full docs
8. Verify all images render correctly

#### Phase 2: Create .mdx File Structure (difficulty: simple)
**Why simple**: Straightforward file creation with templated frontmatter, no complex logic.

**Tasks:**
1. Create directory structure (cli/, features/, configuration/, guides/, reference/)
2. Create all 18 .mdx files with proper frontmatter templates
3. Add placeholder sections in each file based on target content

#### Phase 3: Content Migration (difficulty: complex)
**Why complex**: 6+ files affected, requires careful extraction of content sections, maintaining internal references, updating relative links, and ensuring no content is lost.

**Tasks by target file:**

**Priority 1 (Launch) - 6 files:**
1. introduction.mdx - Overview, What is Panopticon, Features, Dashboard section
2. quickstart.mdx - Installation, requirements, quick start, HTTPS setup
3. concepts.mdx - Core concepts overview (extract from various sections)
4. cli/overview.mdx - CLI overview and philosophy
5. cli/core-commands.mdx - pan sync, doctor, up, down, restart, health
6. cli/agent-commands.mdx - pan work issue/status/tell/kill/approve

**Priority 2 (Core) - 7 files:**
7. cli/workspace-commands.mdx - pan workspace create/destroy/list
8. cli/convoy-commands.mdx - pan convoy start/status/synthesize
9. features/cloister.mdx - AI lifecycle manager, model routing (lines 411-795)
10. features/specialists.mdx - Review/test/merge agents (extract from README)
11. features/skills.mdx - Universal skills system (lines 2185-2254)
12. features/workspaces.mdx - Git worktree workspaces (lines 1785-1997)
13. features/convoys.mdx - Multi-agent orchestration (lines 1543-1700)

**Priority 3 (Advanced) - 5 files:**
14. configuration/projects.mdx - Project registry (lines 273-284)
15. configuration/issue-trackers.mdx - Linear, GitHub, GitLab, Rally (lines 260-272)
16. configuration/polyrepo.mdx - Polyrepo workspace config (lines 796-1407)
17. guides/legacy-codebases.mdx - Enterprise legacy support (lines 33-157)
18. guides/stitch-integration.mdx - Google Stitch UI design (lines 308-410)
19. guides/docker-setup.mdx - Docker/Traefik/HTTPS (extract from various sections)
20. reference/architecture.mdx - Architecture overview (lines 2437-2556)
21. reference/troubleshooting.mdx - Common issues (lines 2685-2894)

#### Phase 4: docs.json Update (difficulty: simple)
**Why simple**: Straightforward JSON config update, templated structure.

**Tasks:**
1. Update navigation structure with all groups
2. Add all page references
3. Verify JSON syntax
4. Test with Mintlify schema validation

#### Phase 5: Verification (difficulty: medium)
**Why medium**: Multiple verification steps, need to test all pages, links, and images.

**Tasks:**
1. Install Mintlify CLI (`npm install -g mintlify`)
2. Run `npx mintlify dev` and verify no errors
3. Test all navigation links
4. Verify all internal page links work
5. Check all screenshots render correctly
6. Test dark/light mode switching
7. Verify responsive layout (resize browser)
8. Check table rendering on mobile width

## File Creation Order

To maintain dependencies and enable incremental testing:

1. **Setup** - Directory structure
2. **Core navigation** - introduction.mdx, quickstart.mdx (Priority 1)
3. **CLI docs** - All cli/*.mdx files (needed for navigation)
4. **Features** - All features/*.mdx files (core functionality)
5. **Configuration** - All configuration/*.mdx files
6. **Guides** - All guides/*.mdx files
7. **Reference** - All reference/*.mdx files
8. **docs.json** - Complete navigation (after all files exist)
9. **README** - Polish the intro (can be done in parallel)
10. **Verification** - Test suite

## Risk Assessment

### Low Risk
- File creation and directory structure
- docs.json updates (can validate syntax)
- Basic frontmatter and page structure

### Medium Risk
- Content migration (might miss internal references)
- Link updates (need to track all internal links)
- Image paths (need to verify relative paths work)

### Mitigation Strategies
- Create content extraction script to track line ranges
- Build internal link inventory before migration
- Test incrementally (don't wait until all files are done)
- Use Mintlify dev server to catch errors early

## Beads Tasks Created

**Task dependency chain (automatically enforced via `bd dep`):**

```
panopticon-769 (file structure) [READY]
    ├─> panopticon-7wl (Priority 1 content)
    ├─> panopticon-92t (Priority 2 content)
    └─> panopticon-36b (Priority 3 content)
            └─> panopticon-5yx (docs.json)
                    └─> panopticon-2hx (verification)

panopticon-say (README polish) [READY, parallel track]
    └─> panopticon-2hx (verification)
```

**Ready to start (no blockers):**
- **panopticon-769**: Create directory structure and .mdx file templates (difficulty: simple)
- **panopticon-say**: Polish README introduction with hero section (difficulty: medium)

**Blocked tasks (will auto-unblock when dependencies complete):**
- **panopticon-7wl**: Migrate Priority 1 content (blocked by panopticon-769)
- **panopticon-92t**: Migrate Priority 2 content (blocked by panopticon-769)
- **panopticon-36b**: Migrate Priority 3 content (blocked by panopticon-769)
- **panopticon-5yx**: Update docs.json (blocked by all 3 content migrations)
- **panopticon-2hx**: Verify local dev server (blocked by docs.json + README polish)

Use `bd ready` to see which tasks are currently unblocked and ready to work on.

## Summary for Implementation Agent

### What You're Building
A complete Mintlify documentation website for Panopticon at www.panopticon-cli.com (currently visible at mindyournow.mintlify.app while domain purchase completes).

### Key Files to Create/Modify
- **18 new .mdx files** in organized directory structure (cli/, features/, configuration/, guides/, reference/)
- **docs.json** - Complete navigation structure with all pages
- **README.md** - Polish the top ~250 lines with hero section, badges, comparison tables, screenshots

### Strategy
- **Dual-purpose documentation**: Keep detailed content in BOTH README (for GitHub) and .mdx files (for docs site)
- **Content source**: Extract from existing README.md using the migration map
- **Testing**: Use `npx mintlify dev` to verify locally before signaling completion

### Acceptance Criteria for Completion
- [ ] All 18 .mdx files exist with proper frontmatter and migrated content
- [ ] docs.json has complete navigation structure
- [ ] `npx mintlify dev` runs without errors
- [ ] All pages render correctly in local dev server
- [ ] All internal links work
- [ ] Screenshots render correctly
- [ ] README top section is polished with badges, hero image, comparison table, feature table

### Design Specifications
- Colors: Light `#FDFDF7` bg, Dark `#09090B` bg, Accent `#D4A27F` (both modes)
- Typography: Serif headings (Georgia fallback), sans-serif body, 1rem/1.65rem line-height
- Layout: Max 64rem width, responsive 3→2→1 columns

### Don't Forget
- All .mdx files need frontmatter with `title` and `description`
- Update relative image paths to work from different directory depths
- Test all internal cross-references between pages
- Verify table rendering on mobile widths
- Check dark/light mode switching works

## Planning Complete
Ready for implementation agent handoff.
