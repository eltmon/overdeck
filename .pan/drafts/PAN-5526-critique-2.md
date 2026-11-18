plan-digest: 56b72f2ccf6f1dfe8a35e5dd01261ac2841e907df89f8aacb32f1e558546c193

## blocks-the-design: No-promote announces promotion

The PRD's replacement activity and TTS text (lines 165–185) selects “promoting with auto-start” whenever consent is granted. In `src/cli/commands/plan-finalize.ts` lines 387–403, those emissions happen before the `noPromote` check at lines 417–436. The public `--no-promote` option is registered in `src/cli/index.ts` line 318. Thus `pan plan finalize --no-promote` with consent would announce promotion even though it never POSTs. Select the promotion wording only when `options.promote !== false`, and add a consent plus `--no-promote` test for both activity and TTS.

## blocks-the-design: No-PRD retry is rejected

The PRD's failure message and docs prescribe `pan plan done <id>` for every failed finalize (`.pan/drafts/PAN-5526.md` lines 209–215 and 243–249). But `--no-prd` is a supported finalize option (`src/cli/index.ts` line 320). Finalize sends `noPrd: true` and saves it in the marker (`src/cli/commands/plan-finalize.ts` lines 420 and 439–447), while plain `pan plan done` sends `noPrd: false` (`src/cli/commands/plan-done.ts` line 27). The route returns 422 if the draft fails the PRD gate without that flag (`src/lib/overdeck/planning-promotion.ts` lines 634–644). A genuinely trivial plan finalized with `--no-prd` therefore cannot follow the proposed recovery instruction. Make the failure command conditional on `options.prd === false` and show `pan plan done <id> --no-prd` in that case; document it and test a failed `--no-prd` run.

## blocks-the-design: Nonterminal responses count as success

FR-6 says an unconfirmed promotion exits 1 and announces recovery (`.pan/drafts/PAN-5526.md` line 83), but the unchanged `promotePlanning` treats every 2xx response as success without checking the payload (`src/cli/commands/plan-finalize.ts` lines 575–603). The route returns HTTP 202 with `inFlight: true` before promotion finishes (`src/lib/overdeck/planning-promotion.ts` lines 573–581), and HTTP 200 with `skipped: 'pending-ask-user-question'` without promoting (`src/lib/overdeck/planning-promotion.ts` lines 602–605). The plan's tests cover only HTTP 200 with `success: true` and HTTP 500, so these cases would still print “Planning promoted” and exit 0. Have `promotePlanning` require the route's terminal `success: true` response, and add 202 in-flight and 200 skipped tests; report these as unconfirmed without claiming they failed.
