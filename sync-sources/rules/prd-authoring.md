---
scope: universal
---
### PRD / spec authoring — write for the cheapest model that will execute it

PRDs, specs, and plans (e.g. `.pan/drafts/<issue>.md`, vBRIEF items) are executed
by implementation agents that may run on cheaper or smaller models than the one
that wrote the plan. Ambiguity in the spec becomes wrong guesses in the diff.
Author every plan so it can be executed without re-research or judgment calls:

- **Glossary first.** Define every term of art the document uses before using it.
- **Verified references.** Exact file paths and line numbers for every claim,
  checked against the codebase at writing time — never cited from memory. Where a
  line number may drift, also quote the code to search for.
- **Before/after snippets** for each non-trivial change, in the codebase's own
  style.
- **Numbered work items**, each carrying: what/why, the exact files and functions
  touched, step-by-step changes, and the named tests that prove it.
- **Numbered requirements.** Functional requirements are labeled FR-1, FR-2, …; non-functional NFR-1, …, in a ## Requirements section. Plan items reference them via metadata.traces. Never renumber existing IDs in a revision — retire ids explicitly instead.
- **Decisions made in the doc.** State decision rules plainly ("a model change, a
  harness change, or both ⇒ fresh session"). If a step genuinely requires live
  verification, mark it as an explicit **implementation checkpoint** with a stated
  fallback — never leave it implied.
- **Restate intersecting repo rules** (fake timers for delay tests, async-only
  primitives, style guides) inside the doc. Do not assume the executor recalls
  them.
- **Acceptance criteria** that map 1:1 to work items and are mechanically
  checkable.

The test before finalizing: *could a model that cannot re-derive context execute
each work item from this text alone?* If any step requires judgment, either make
the decision in the document or mark the checkpoint with its fallback.
