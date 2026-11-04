plan-digest: 703694359a285275b6ff75a5a83490aca3f64c962ad5bd8862a0d4fcce3643d6

## sharpens-framing: Fix the migration count criterion

The current checkout has 126 paths in `package.json:141`, but `git show origin/main:package.json` now yields 128. The two added paths are `src/components/push/__tests__/TurnOnNotificationsButton.test.tsx` and `src/components/Settings/anywhere/__tests__/PushPanel.test.tsx`. WI-3 correctly says to add paths gained on main before the equivalence check, while PRD AC-2 still requires exactly 126 lines. An implementer who follows WI-3 cannot satisfy AC-2. Change AC-2 to require the count in the current `origin/main` script at migration time, with all paths present and the equivalence check passing. The draft xBRIEF's `subset-list-file.ac1` already allows that count.

## footnote: Make the docs check line-wrap safe

PRD WI-5 proposes `docs/ISSUE-VIEW.md` text with `npm run test:frontend-subset` and `scripts/frontend-test-subset.txt` on adjacent Markdown lines (PRD lines 359-361), while its verification says every `git grep -n "test:frontend-subset"` hit must name the list file. `git grep -n` prints only the matching line, so that stated check fails even when the specified edit is correct. Check each hit with surrounding context, or phrase the criterion as a paragraph-level check. The draft xBRIEF's `docs-subset-list` expected output needs the same adjustment.
