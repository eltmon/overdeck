plan-digest: d8092ed19125ffbb0a2737880dcfafa611a9246e4799a3858b9480b5fc36f132

## blocks-the-design: Queue timeout bypasses the entire chain

The PRD's FR-6 and D9 (`.pan/drafts/PAN-5617.md`, lines 112-115 and 169-179) say a queue or CPU timeout runs the whole chain unadmitted, while D9 says the 60-minute bound eventually fails closed. The code does not support that conclusion: `src/lib/cloister/quality-gate-admission.ts`, lines 755-756, throws with the **last** wait kind; lines 798-803 set that kind to `slots` or `queue` while other gates hold slots, including during memory pressure. `src/lib/cloister/gate-admission-run.ts`, lines 86-89 and 170-177, fails closed only for a timeout whose last kind is `memory`. Under the proposed `OVERDECK_GATE_ADMISSION=0` propagation, a chain that times out behind other gates runs all 13 tsc processes without any further admission. Today only the timed-out lane runs unadmitted; the next lane tries to acquire again. This weakens the memory protection precisely during a prolonged queue.

Smallest change: make chain admission timeouts for `queue`, `slots`, and `cpu` exit 75 without starting the chain, while keeping the chosen fallback for non-timeout setup errors if desired. Add an injected-acquire test for a `queue` timeout that asserts no child spawn. Update FR-6, D9, and the failure-mode docs accordingly.

## sharpens-framing: The invariant still says every lane queues

The exact CLAUDE.md replacement in PRD WI-6 (`.pan/drafts/PAN-5617.md`, lines 489-493) leaves the sentence saying "every `tsc` lane ... enters the shared admission queue" even though the same plan's FR-1 and the proposed wrapper run lanes inside a chain with `OVERDECK_GATE_ADMITTED=1`. The existing bypass is explicit in `scripts/tsc-admitted.mjs`, lines 33-35 and 52-53. An implementer following WI-6 verbatim would publish a false invariant.

Smallest change: state that standalone lanes enter the queue individually and that `npm run typecheck` and `npm run lint:effect-diagnostics` enter once for their chains.
