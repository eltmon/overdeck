plan-digest: b30cfe95248836c56933cf745fde4870313590246c3456d09d65bc655f3d583e

## sharpens-framing: Screenshot links need a path relative to the new file

PRD WI-1 and WI-5 name screenshots as `acceptance/pan-<n>-<step>.png` (lines 161–163 and 243–246), while the new evidence file itself is `apps/mobile/acceptance/PAN-<n>.md`. Existing links in `apps/mobile/ACCEPTANCE.md`, line 28, use `acceptance/01-sign-in-screen.png` because that document is one directory above the screenshots. Copying that link form into a per-issue file would resolve to `apps/mobile/acceptance/acceptance/...` and break the evidence link. State in the per-issue file convention that Markdown links use `pan-<n>-<step>.png` relative to `PAN-<n>.md`; keep `apps/mobile/acceptance/pan-<n>-<step>.png` as the repository path.

## sharpens-framing: The promised issue explanation has no plan item

PRD D-1, lines 93–95, says the issue gets a comment explaining why `merge=union` was rejected. The xBRIEF has six items covering file edits and a test, with no issue-comment action or acceptance criterion. An executor can complete every item without telling readers of the issue why its proposed fix changed. Add a final item to post the probe result and per-issue-file decision to the issue, or remove that promise from D-1.
