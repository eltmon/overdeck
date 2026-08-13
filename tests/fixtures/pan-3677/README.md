# PAN-3677 wedge fixtures

Redacted JSONL fixtures for the planning background-task wedge detector
(`src/lib/cloister/planning-wedge.ts`).

Both files were structurally derived from the two real incident transcripts
(planning-min-888 and planning-min-889, 2026-08-13) and then redacted: entry
`type` / `message.role` / `content` nesting, queue-operation shapes, XML tags,
and event ORDERING are exactly as the harness wrote them; every prompt, tool
input/output, path, and description is replaced with `[redacted]`, and task
ids / session ids are synthetic.

- `min-889-all-finished.jsonl` — both background Explore children finished;
  both collected via blocking TaskOutput; the parent hung on the provider call
  that followed the final collection.
- `min-888-failed-and-finished.jsonl` — the frontend explorer failed at the
  262,144-token model limit while the API explorer kept running; an operator
  `pan tell` was consumed mid-exploration (a prompt boundary that must NOT
  discard the still-running child's evidence); the parent hung right after the
  surviving child's completion notification was consumed.

Keep these small and redacted — never commit real session content here.
