# OKF Lint Prompt

Use this prompt for `/okf lint`. The pass is advisory only: it reports findings and suggestions, never writes bundle files, never blocks merges, and never replaces `validate.py --strict` or `diff_lint.py`.

## Patrol

Review the resolved OKF bundle and surface:

- Contradictions: concepts that disagree about behavior, decisions, ownership, APIs, schemas, or invariants.
- Staleness: concepts whose citations, timestamps, referenced files, or described behavior appear out of date.
- Orphans: concepts with no inbound links, no useful tags, no index path, or links pointing to missing concepts.
- Oversized concepts: concepts likely to exceed embedding `max_tokens`; suggest split candidates that preserve citation anchors and concept IDs.

## Output

Return advisory findings only. For each finding, include:

- Category: `contradiction`, `staleness`, `orphan`, or `oversized`.
- Concept IDs involved.
- Evidence from loaded concept text or cited files.
- Suggested follow-up edit or `/okf author` topic.

If no findings are present, say that the advisory patrol found no issues. Do not edit files without explicit confirmation.
