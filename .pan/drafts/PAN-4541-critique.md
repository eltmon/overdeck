plan-digest: bc821085ae7808befa705a87707995aad54aa5ef7e070610ab8ea8d0d1a7f49d

## sharpens-framing: WI-1 grep expects the wrong count

The PRD's WI-1 and the xBRIEF expect `grep -cE "(from|import)\s*\(?\s*[\"'][^\"'\n]+[\"']" src/lib/jev/settings-validation.ts` to print `1` after the comment edit. I replayed the proposed edit without changing the file: `sed '9s/from "custom"/and the "custom" route/' src/lib/jev/settings-validation.ts | grep -cE "(from|import)\s*\(?\s*[\"'][^\"'\n]+[\"']"` prints `0`. The bracket expression excludes the literal letter `n`, so it misses the real `./config.js` import on line 7. Removing `\n` from that expression makes the same check print `1`. Update the PRD and xBRIEF verify command to use `[^\"']+`, retaining the expected count of `1`.

## sharpens-framing: Bundled lexer still probes node_modules

The PRD's WI-3 asks the docs to say that bundling the lexer means "the check needs nothing from `node_modules` to run" (PRD line 322). The scanner explicitly calls `createRequire(scriptPath)` and `requireFrom.resolve(specifier)` in `src/lib/bundle-imports.ts` lines 30 and 37 to inspect external packages. Say that the **lexer itself** needs no `node_modules` entry, while the preflight still resolves external packages there.
