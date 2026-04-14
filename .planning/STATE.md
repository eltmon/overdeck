# PAN-705: Command Taxonomy Reorganization

## Status: In Progress

## Current Phase
Working through beads systematically. Starting with setup/foundational beads before CLI implementation.

## Completed Work
- [x] panopticon-cli-be5: Committed PRD + quick-reference docs (commit: a330e3be)
- [x] panopticon-cli-4pp: Moved PRD from planned/ to active/pan-705/ (commit: 8c258178)

## Remaining Work
- [x] panopticon-cli-9m0: Bumped version to 0.7.0 (commit: 1fca6f9f)
- [x] panopticon-cli-asp: Created pan admin group with cloister commands (commit: fffac536)
- [x] panopticon-cli-6f6: pan admin beads (commit: 28b6e081)
- [x] panopticon-cli-d76: pan admin config (commit: 5824d5bb)
- [x] panopticon-cli-44j: pan admin remote (commit: 6e0673d9)
- [x] panopticon-cli-73x: pan admin db (commit: 22be7e87)
- [x] panopticon-cli-rgr: pan admin specialists (commit: ef060f73)
- [x] panopticon-cli-1sd: pan admin hooks install (commit: 9d2b2fc4)
- [x] panopticon-cli-f1v: pan start <id> (commit: f21a8e82)
- [x] panopticon-cli-u7y: pan tell <id> (commit: 150cffe5)
- [x] panopticon-cli-dfb: pan kill <id> (commit: 5320e057)
- [x] panopticon-cli-vwd: pan resume <id> (commit: efbe3f91)
- [x] panopticon-cli-agh: pan recover <id> (commit: 2532a087)
- [x] panopticon-cli-a0u: pan sync-main <id> (commit: ae4b4ba5)
- [x] panopticon-cli-a01: pan done <id> (commit: ae4b4ba5)
- [x] panopticon-cli-5ul: pan approve <id> (commit: ae4b4ba5)
- [x] panopticon-cli-50h: pan reopen <id> (commit: ae4b4ba5)
- [x] panopticon-cli-hw3: pan wipe <id> (commit: ae4b4ba5)
- [x] panopticon-cli-jcn: pan close <id> (commit: ae4b4ba5)
- [x] panopticon-cli-6fs: pan plan / pan plan finalize (commit: pending)
- [x] panopticon-cli-7n3: pan review (commit: pending)
- [x] panopticon-cli-2mf: pan show <id> (commit: pending)
- [x] panopticon-cli-pei: pan issues (commit: pending)
- [x] panopticon-cli-5z3: Deleted pan work command group (commit: e307e22a)
- [x] panopticon-cli-oyb: pan admin migrate-config (commit: fb273e21)
- [x] panopticon-cli-f04: pan admin tldr (commit: ee1a4652)
- [x] panopticon-cli-rg8: pan admin fpp (commit: 02af5fa2)
- [x] panopticon-cli-q15: pan admin tracker (commit: 9d819edc)
- [ ] panopticon-cli-ej8: Rename /api/work/* lifecycle routes to /api/issues/*
- [ ] panopticon-cli-64h: Create /api/review/* routes
- [ ] panopticon-cli-ub1: Create /api/show/* observation routes
- [ ] panopticon-cli-a6h: Create /api/admin/* plumbing routes
- [ ] panopticon-cli-7zw: Update packages/contracts RPC types
- [ ] panopticon-cli-41f: Update frontend RPC client and Zustand store
- [ ] panopticon-cli-njd: Replace hardcoded legacy command strings in frontend
- [ ] panopticon-cli-9kq: Update kanban card + inspector panel action labels
- [ ] panopticon-cli-y4k: First-launch upgrade announcement banner
- [x] panopticon-cli-i3m: Updated USAGE.md and INDEX.md (commit: 84e61770)
- [ ] panopticon-cli-mjv: Update doc references in all PRDs
- [ ] panopticon-cli-auj: Update hook scripts and installed shell aliases
- [ ] panopticon-cli-302: pan doctor: flag legacy invocations
- [x] panopticon-cli-oo1: Plain-text fixture test for pan --help (commit: 1f3b4e09)
- [ ] panopticon-cli-xqq: Umbrella /pan skill with dispatch
- [ ] panopticon-cli-fqg: Rename skills to match new CLI verbs
- [ ] panopticon-cli-8y6: Skill template
- [ ] panopticon-cli-ix7: Rewrite skill descriptions CLI-first
- [ ] panopticon-cli-naa: Curate 8-10 flat shortcut skills
- [ ] panopticon-cli-t1p: pan sync deletes legacy skill files
- [ ] panopticon-cli-gsq: Plain-text fixture test for synced skill set
- [x] panopticon-cli-cf4: CHANGELOG entry with full migration table (commit: b38c071d)

## Key Decisions
- D1: PRD exists at docs/prds/planned/pan-command-taxonomy-reorg.md, active copy at docs/prds/active/pan-705/
- D2: All Phase 1-3 CLI bead pattern is: register new command path in src/cli/index.ts pointing to existing handler

## Specialist Feedback
(none yet)
- **[2026-04-14T15:43Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-14T15:44Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-14T17:32Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
- **[2026-04-14T17:37Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/004-review-agent-changes-requested.md`
- **[2026-04-14T17:42Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/005-review-agent-changes-requested.md`
- **[2026-04-14T17:43Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/006-review-agent-changes-requested.md`
- **[2026-04-14T17:58Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/007-review-agent-changes-requested.md`
