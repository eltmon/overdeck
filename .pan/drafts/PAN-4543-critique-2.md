plan-digest: 360352e684b59ff97816818e51a8032394d9d72ff4dcc880f3545c3577474bf9

## blocks-the-design: Post-gate rewrite lacks run ownership

The PRD's D4 says the latest `running` artifact at the post-gate check is certainly this run's. The runner's progress writes are best effort and silently catch write failures (`src/lib/cloister/verification-runner.ts:503-519`); the post-gate forge check then awaits before finalization (`:592-593`). The proposed helper checks only `outcome === 'running'` before rewriting the shared latest file (`.pan/drafts/PAN-4543.md`, WI-1). A previous or overlapping run's `running` artifact can therefore be relabeled `skipped`. The supervisor's in-memory deduplication is process-local (`src/lib/cloister/verification-worker-supervisor.ts:160,242-256`), and its read/spawn/write sequence (`:169-236`) does not make ownership of that file atomic. Carry a run identifier from the runner's progress writes into the helper and rewrite only if the latest artifact has that identifier; test a mismatched running artifact and a failed progress write.

## sharpens-framing: The skipped reason is hidden in the Lint panel

WI-3 adds `Skipped: <reason>` to the synthetic transcript, but `SessionPanel.tsx:410-416` opens `VerificationGatesPanel` for the Lint node. That panel uses the transcript only when there is no artifact (`VerificationGatesPanel.tsx:80-91`), while the skipped case necessarily has an artifact and the panel never reads `skipReason` (`:95-145`). The operator will see “Quality gates skipped” without the reason, alongside any failed gate icons. Add `skipReason` to the panel response type, render it beneath the heading, and make that behavior an acceptance criterion.

## sharpens-framing: A running artifact is not proven stale

FR-5 and WI-5 call every `running` artifact “stale non-terminal” when landed work and main CI are green. `checkVerificationRow` reads only the artifact and settlement (`src/lib/lifecycle/dod-gate.ts:442-468`); the proposed condition has no age or worker-liveness check. A verification worker can still be active (`src/lib/cloister/verification-runner.ts:543-564`), so the observed text would assert a fact the gate has not established. Describe the artifact as lacking a final verdict, or require a liveness/age check before labeling it stale.
