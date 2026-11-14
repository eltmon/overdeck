plan-digest: 201bd64b0879911cdc7ea2605942ca488e1b963956d08677916b47020f726ae3

## blocks-the-design: First Enter checks a stale screen

The PRD's W3 After snippet (`.pan/drafts/PAN-5232.md`, lines 326–335) checks `paneHasBlockingChoiceMenu(lastScreen)` after the settle wait but does not refresh `lastScreen`. In `src/lib/terminal-backends/herdr-submit.ts`, lines 78–86, the last `pane.read` occurs before `pasteSettleMs`, which waits at least 600 ms and up to 3,000 ms (lines 31–33). A permission menu can appear during that wait. The existing permission-menu test models `agent.get` as `idle` (`tests/unit/lib/terminal-backends/herdr-submit.test.ts`, lines 119–125), so the proposed `blocked()` check does not close that gap: Enter can answer the new menu despite FR-9. The `read()` helper also converts a failed fresh read to `null` (lines 51–59), so retaining an older `lastScreen` would still send Enter blind.

After settling, read the visible pane again immediately before Step 3. Hold the submit key if that read fails or shows a blocking menu; then check agent status. Add a test whose first read shows the pasted composer and whose next read, after the settle wait, shows a permission menu while `agent.get` remains `idle`. Update W3's instruction that the read-throws test must keep its `unconfirmed` expectation if the new fail-closed behavior changes it.

## sharpens-framing: Test failures cannot prove every mock was converted

W2 calls its temporary legacy-branch change a “completeness check” and says to convert mocks that fail (`.pan/drafts/PAN-5232.md`, lines 283–285). The existing `{ text: '' }` wire mock in `tests/unit/lib/terminal-backends/herdr-submit.test.ts`, line 155, would still produce `''` with that temporary change, so its test's `unconfirmed` assertion (lines 160–165) would pass. Thus a green run cannot establish FR-4's “every wire-level mock” requirement.

Keep the test run, and add a static search over the Herdr test files for every `pane.read` mock. Review each returned response shape explicitly, including tests whose expected result is empty. This makes the completeness criterion checkable without relying on assertion failures.
