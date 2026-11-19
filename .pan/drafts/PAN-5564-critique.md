plan-digest: d555e1944ae486181000cdc74900a055f095b5d4e265d4ba424d6cda3b8d49a1

## sharpens-framing: Delayed mount is not a root-cause proof

The PRD's checkpoint at `.pan/drafts/PAN-5564.md`, line 108, says a 20 ms `setTimeout` reproducing three failures "confirms the diagnosis," and says absence of those exact failures means the diagnosis is wrong. The test at `src/dashboard/frontend/src/components/explorer/code/__tests__/changes-view.test.tsx`, lines 63-89, only shows that edits made before `onMount` miss the listener. Delaying `onMount` by 20 ms creates that condition regardless of whether React's passive-effect timing caused the CI failure; timers can also fire after a failed test unmounts, and `CodePane.tsx`, lines 189-195, then registers the late editor. The control demonstrates that the assertions depend on mount order, but does not independently prove the reported scheduling path or guarantee all three failure lines. Keep it as an optional mechanism check, and require investigation if its output differs rather than treating one run as a decisive diagnosis or stop condition.

## sharpens-framing: Lint is missing from verification metadata

The PRD at `.pan/drafts/PAN-5564.md`, lines 130 and 112, and the xBRIEF item Action step 4 require `npm run lint`, but the item's `metadata.verify_commands` lists the single test, the 30-run loop, the branch diff, and `npm run typecheck` only. A worker following that executable command list can finish without the PRD's lint gate. Add `npm run lint` to `verify_commands` with its expected result, or remove it consistently from the PRD and Action if it is not required.
