plan-digest: e551486b992edacaa92037c70271e6d72bb9d5fcd07a45ed398820aff8e83ede

## blocks-the-design: supervisor exception loses its runtime guard

[conversation-runtime.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4562/src/lib/overdeck/conversation-runtime.ts), lines 297–302, currently disables the supervisor only when **both** the harness is `codex` and `codexTransport` is `app-server`. The PRD at [.pan/drafts/PAN-4562.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4562/.pan/drafts/PAN-4562.md), lines 119 and 194, drops the harness condition. That changes the exported function for a valid call such as `shouldUseSupervisorForConversation('claude-code', { codexTransport: 'app-server' })`: it currently returns true outside Docker and would return false. The sole production caller happens to set that option only in the Codex branch, but this is still an unrequested behavior change in the exported function and contradicts NFR-1. Replace the name check with the existing declaration, for example `getHarnessBehavior(harness).usesCodexHome && options.codexTransport === 'app-server'`, and test a non-Codex harness with that option.

## footnote: readiness default references an unbound name

The PRD at [.pan/drafts/PAN-4562.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4562/.pan/drafts/PAN-4562.md), lines 196–203, specifies `switch (getHarnessBehavior(harness).readinessKind)` followed by `const unreachable: never = kind` in `default`, but no `kind` variable is declared. Bind `const kind = getHarnessBehavior(harness).readinessKind` before the switch and switch on `kind`; the proposed exhaustive check then compiles.
