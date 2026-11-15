plan-digest: b155b304b1780f8f4c6cbcbf2960d18d297e4a0e6ac9bb5e5cc2cd07d7ba46b8

## blocks-the-design: Nested plan-home symlink still writes to primary

The proposed guard checks `realpathSync(workspacePath)` only. In `src/lib/pan-dir/specs.ts:30-42`, `ensurePanDirs` creates `.pan/specs` recursively, and `writeSpec` writes through that path at lines 123-144. I reproduced the counterexample in a temporary directory: with a real `workspaces/feature-pan-5316` directory and its `.pan` symlinked to the primary checkout's `.pan`, the proposed equality check returned `true` and the file appeared in the primary `.pan/specs`. A polyrepo's configured plan-home subrepo can likewise be a symlink because `resolveInfraRepo` joins its path without checking it (`src/lib/projects.ts:888-909`). This violates FR-2 and the promised “never the primary checkout” rule. Before writing, validate the resolved plan home and existing `.pan`/`specs` path components against the workspace, then test a nested symlink to the primary.

## sharpens-framing: The regression test never exercises skip-plan start

PRD Decision 8 says the issue asks for a test that runs `pan start --plan skip` from the primary root, but WI-2 calls `writeAutoStartXBrief` directly and never runs the CLI or sets its cwd. The actual decision in `src/cli/commands/start.ts:957-960` first calls `findPlanSync`; that lookup falls back to the primary checkout at `src/lib/xbrief/io.ts:223-229`. A primary spec left by the old bug can therefore suppress synthesis, leaving the workspace without a spec while all proposed writer tests pass. Add a focused test of the skip-plan decision from a primary cwd, including this pre-existing-primary-spec case, or state explicitly that this case remains outside the issue's acceptance criteria.

## sharpens-framing: Documentation still contradicts workspace ownership

WI-3 adds workspace ownership at `docs/XBRIEF.md:91` and changes the lookup paragraph at line 423, but the same document says “There is no workspace-local copy” at line 131 and labels the section “single-spec-on-main” at line 421. Its proposed literal `<project>/workspaces/feature-<issue>/.pan/specs/` is also wrong for a configured polyrepo plan home: `src/lib/pan-dir/paths.ts:46-59` and `src/lib/projects.ts:888-909` put `.pan/specs` in the chosen subrepo inside that workspace. Update the overview and heading, and describe the target as `<resolvePlanHome(workspace)>/.pan/specs/` with the simple monorepo path as an example.
