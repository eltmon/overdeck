plan-digest: 5799aaa7f672563d80cbe34685371d827b36b84d0fbc6134c1e771edfded348a

## sharpens-framing: Legacy dates are not full-refresh dates

`roles/plan.md:49` currently tells planners to update the date after correcting any stale statement. W1 preserves `2026-11-04` while changing only footer lines, but D2 and the proposed `roles/plan.md` text redefine that date as the last time the whole file was verified. The preserved date cannot establish that claim. State that existing dates are legacy markers until a full refresh, or re-verify each affected file before presenting its preserved date as a full-file verification date.

## sharpens-framing: Count footer lines with an anchored check

W1's verification uses `grep -c 'last-verified' .overdeck/context/codebase/*.md` and expects one match per file. The PRD's D5 and W5 test case 5 expressly allow a prose line mentioning `last-verified`, which would make that command report two even with exactly one footer. Replace this check and its xBRIEF expected output with an anchored footer count, such as `grep -Ec '^[[:space:]]*<!--[[:space:]]*last-verified' .overdeck/context/codebase/*.md`; retain the separate last-line check.
