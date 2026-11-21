plan-digest: d5182ffeb9446bbcf3f1b6d5c78d72120b6c5a2f865f93670af0de073ff9cf5e

## blocks-the-design: A memory passer can erase the CPU block

The admission loop permits a later, smaller waiter to pass a head blocked on memory (`/home/eltmon/Projects/overdeck/workspaces/feature-pan-5588/src/lib/cloister/quality-gate-admission.ts`, lines 765–805 and 863–875). The proposed success-path clear runs for **every** unpressured admission, including that passer. A concrete sequence is: head H records CPU pressure at time 1; H later becomes memory-blocked; later waiter M passes H, gets two low CPU samples, and clears `cpu-blocked-since.json`; memory recovers after the bound. H still has its own `cpuBlockedSince = 1` (lines 696–703), so it takes the `cpuAlone` path (lines 890–895), which skips pressure sampling and therefore never recreates the marker. After H releases, the next head starts a fresh bound. This reproduces the repeated wait the issue aims to remove, even if CPU pressure remains high after M's brief low samples.

Smallest change: limit marker clearing to an unpressured admission by the queue head (`position === 0`), and revise FR-4/WI-3 and the docs accordingly. Add a test with a CPU-blocked head, a memory-passing later waiter, and a third gate that inherits the original marker after the head bypasses.

## sharpens-framing: The bypass log attributes the queue wait to each gate

`cpuBypassedMessage(subject)` says the named gate was “admitted alone after waiting past the CPU bypass bound” (`/home/eltmon/Projects/overdeck/workspaces/feature-pan-5588/src/lib/cloister/gate-admission-run.ts`, lines 80–82). WI-3 explicitly tests a second gate that enqueues **after** the first releases and bypasses with the clock unchanged, so that gate did not wait past the bound. PRD D5's explanation that *the queue* waited does not match the message's subject.

Smallest change: revise the message and its test to attribute the elapsed bound to the admission queue, then remove D5's no-wording-change decision.
