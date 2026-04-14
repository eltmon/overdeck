# PAN-705: Command Taxonomy Reorganization

## Status: In Progress

## Current Phase
Working through beads systematically. Starting with setup/foundational beads before CLI implementation.

## Completed Work
- [x] panopticon-cli-be5: Committed PRD + quick-reference docs (commit: a330e3be)
- [x] panopticon-cli-4pp: Moved PRD from planned/ to active/pan-705/ (commit: 8c258178)

## Remaining Work
- [x] panopticon-cli-9m0: Bumped version to 0.7.0 (commit: 1fca6f9f)
- [x] panopticon-cli-asp: Created pan admin group with cloister commands (commit: pending)
- [ ] panopticon-cli-6f6: pan admin beads
- [ ] panopticon-cli-d76: pan admin config
- [ ] panopticon-cli-44j: pan admin remote
- [ ] panopticon-cli-73x: pan admin db
- [ ] panopticon-cli-rgr: pan admin specialists
- [ ] panopticon-cli-1sd: pan admin hooks
- [ ] panopticon-cli-f1v: pan start <id>
- [ ] panopticon-cli-u7y: pan tell <id>
- [ ] panopticon-cli-dfb: pan kill <id>
- [ ] panopticon-cli-vwd: pan resume <id>
- [ ] panopticon-cli-agh: pan recover <id>
- [ ] panopticon-cli-a0u: pan sync-main <id>
- [ ] panopticon-cli-a01: pan done <id>
- [ ] panopticon-cli-5ul: pan approve <id>
- [ ] panopticon-cli-50h: pan reopen <id>
- [ ] panopticon-cli-hw3: pan wipe <id>
- [ ] panopticon-cli-jcn: pan close <id>
- [ ] panopticon-cli-6fs: pan plan / pan plan finalize
- [ ] panopticon-cli-7n3: pan review
- [ ] panopticon-cli-2mf: pan show <id>
- [ ] panopticon-cli-pei: pan issues
- [ ] panopticon-cli-5z3: Delete pan work command group
- [ ] panopticon-cli-oyb: pan admin migrate-config
- [ ] panopticon-cli-f04: pan admin tldr
- [ ] panopticon-cli-rg8: pan admin fpp
- [ ] panopticon-cli-q15: pan admin tracker
- [ ] panopticon-cli-ej8: Rename /api/work/* lifecycle routes to /api/issues/*
- [ ] panopticon-cli-64h: Create /api/review/* routes
- [ ] panopticon-cli-ub1: Create /api/show/* observation routes
- [ ] panopticon-cli-a6h: Create /api/admin/* plumbing routes
- [ ] panopticon-cli-7zw: Update packages/contracts RPC types
- [ ] panopticon-cli-41f: Update frontend RPC client and Zustand store
- [ ] panopticon-cli-njd: Replace hardcoded legacy command strings in frontend
- [ ] panopticon-cli-9kq: Update kanban card + inspector panel action labels
- [ ] panopticon-cli-y4k: First-launch upgrade announcement banner
- [ ] panopticon-cli-i3m: Update docs/USAGE.md and docs/INDEX.md
- [ ] panopticon-cli-mjv: Update doc references in all PRDs
- [ ] panopticon-cli-auj: Update hook scripts and installed shell aliases
- [ ] panopticon-cli-302: pan doctor: flag legacy invocations
- [ ] panopticon-cli-oo1: Plain-text fixture test for pan --help
- [ ] panopticon-cli-xqq: Umbrella /pan skill with dispatch
- [ ] panopticon-cli-fqg: Rename skills to match new CLI verbs
- [ ] panopticon-cli-8y6: Skill template
- [ ] panopticon-cli-ix7: Rewrite skill descriptions CLI-first
- [ ] panopticon-cli-naa: Curate 8-10 flat shortcut skills
- [ ] panopticon-cli-t1p: pan sync deletes legacy skill files
- [ ] panopticon-cli-gsq: Plain-text fixture test for synced skill set
- [ ] panopticon-cli-cf4: CHANGELOG entry with full migration table

## Key Decisions
- D1: PRD exists at docs/prds/planned/pan-command-taxonomy-reorg.md, active copy at docs/prds/active/pan-705/
- D2: All Phase 1-3 CLI bead pattern is: register new command path in src/cli/index.ts pointing to existing handler

## Specialist Feedback
(none yet)
