---
scope: dev
---
### Name PRD feedback files with the PRD and model

When providing feedback on a PRD, write the feedback to a sibling markdown file
whose filename is the PRD filename stem plus `-FEEDBACK-<model>.md`.

Use the model string that produced the feedback so parallel reviews are
traceable and do not overwrite each other. Example: feedback on
`PAN-1234.md` from `gpt5.5` goes in `PAN-1234-FEEDBACK-gpt5.5.md`.
