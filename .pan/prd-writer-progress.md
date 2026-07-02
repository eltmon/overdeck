# PRD-writer progress — codebase-health refactor queue (2026-07-02)

Shas are backfilled on the following commit (a commit cannot contain its own sha).

- [x] PAN-2227 — committed 1952ca21dc — premise verified and worse than stated: 7 baseline entries cover files now UNDER the 1000 ceiling (MessagesTimeline.tsx is 8 lines, baselined 1,620) and 10 are stale-high (deacon.ts 3,403 vs 7,180) — >13k lines of silent regrowth headroom; 2 of the 4 historical bump commits lack issue refs. CI lint checkout is shallow (no fetch-depth), so the bump audit needed a two-mode design (pre-push range mode primary, lint last-commit mode + fetch-depth 0 backstop).
- [x] PAN-2231 — committed (this commit; sha backfilled next) — premise verified: review-agent.test.ts STILL introspects src (repointed post-#2124 but same class); detector heuristic locked (quote-bounded src/ literal OR 'src', segment + read call) — 28 offenders at authoring; no-loss-audit tests are a sanctioned class, baselined not banned; the guard's own test file trips the detector and is baselined day one (D5).
