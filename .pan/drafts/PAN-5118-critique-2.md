plan-digest: 5725ee1fdd8719d1d86956f204bffc986f60553effb8a2b4971d7bb6297057dd

## blocks-the-design: Batch refusals exceed the stderr tail

The PRD permits 500 IDs of up to 200 characters (lines 31 and 311-317) and says the compact multi-ID refusal fits the self-job runner's 16 KiB stderr tail (lines 62 and 560). Its proposed `notDoneMessage` still joins every missing ID into one line (lines 237-245). The current runner tails failure stderr to 16,384 bytes (`src/dashboard/server/services/self-jobs.ts`, lines 30, 83-85, 146-147); the proposed work item 7 changes only stdout. Reproducing the proposed line with 500 valid 200-character IDs gives 101,112 bytes (`node -e` length check), so an MCP caller loses most failing IDs and FR-3 is false. Keep the full stderr for `task-done` jobs too, up to the existing 4 MiB child buffer, and test a maximum-size refusal through `runPanJob`.

## blocks-the-design: No-upstream refusal omits every ID

The PRD's no-upstream reason deliberately stays `the branch in ${root} has no upstream — push it before completing the item` (line 65), matching `unpushedCommitCount` in `src/lib/xbrief/continue-state.ts`, lines 399-405. Proposed `notDoneMessage` prints an unpushed failure's reason but never its `itemIds` (PRD lines 237-245). With several IDs corroborated in a repo without an upstream, stderr gives a count and path but names none of the failing IDs, contrary to FR-3. Include the failure's `itemIds` in the multi-ID unpushed line, while keeping the single-ID text unchanged, and test the no-upstream batch case.

## blocks-the-design: Remote finish repeats done before push

The PRD tells the implementer to change the remote final `pan task done` line to its multi-ID form (work item 5, near line 420). In `src/lib/cloister/prompts/work.md`, lines 341-349, that line is in the “When ALL tasks are complete” block before the final `git push`. After the per-item workflow closes the last item, `commitContinue` has made a local continue commit (`src/cli/commands/task.ts`, lines 87-98 and 174-181), so the repeated done call hits the upstream-ahead refusal (`src/lib/xbrief/continue-state.ts`, lines 439-445). Remove that redundant final done line from the remote block; the per-item workflow already closed each item and its ACs.

## sharpens-framing: Missing plan produces an empty recovery command

FR-14 and work item 9 unconditionally render `pan task done ${issueId} ${itemIds.join(' ')}` from the incomplete-plan-items feedback. `checkIncompletePlanItems` can return only `The required xBRIEF checklist is missing or unreadable` (`src/lib/work/done-preflight.ts`, lines 20-21), which has no `- <id>` lines. The verifier's parser then yields `itemIds = []` (`src/lib/cloister/verification-runner.ts`, lines 792-804), and the proposed feedback tells an agent to run `pan task done PAN-...` with no item. Render the batch command only when at least one ID was parsed; retain the existing return-to-planning guidance for a missing or unreadable plan, and test that branch.
