plan-digest: b9d9409faa153da48de48c626d8926fa75662197a5c07ce7ad25298646d0dd8e

## sharpens-framing: foreign launcher warning gives an incomplete fix

WI-2 step 2 tells the resolver to warn “run pan sync” for both an absent and a foreign `~/.overdeck/bin/semgrep`. In `src/lib/semgrep/install.ts`, lines 115–123, `ensureSemgrepInstalled` refuses a foreign launcher and tells the operator to move it before syncing. Lines 110–112 also return `present` before checking ownership when that foreign binary reports version 1.180.0. Thus the proposed warning cannot restore MCP for the foreign case. Keep the absent-path warning as written, but make the foreign-path warning say to move the foreign launcher out of the way and then run `pan sync`; test the two messages separately.

## footnote: harness matrix row count

WI-8 step 1 says the harness table has “exactly these rows,” then lists four groups: Claude Code, Codex, ACP host, and the combined pi/oh-my-pi/Kimi Code native/Muse/Prime Agent group. `docs.ac1` calls them “the five PRD rows.” Change that count to four, or name the intended fifth row.
