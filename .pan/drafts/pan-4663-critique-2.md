plan-digest: c9b7714f1a3635dd154bc4a5064ee365a0d9695c2f1f0614a88ef8a6405e393a

## sharpens-framing: Fallback acceptance omits three allowed failures

The PRD's WI-1 fallback at `.pan/drafts/pan-4663.md`, lines 213–224, permits pool exhaustion, image build failure, registry pull failure, and a missing external `overdeck` network. Its AC-2 at lines 328–331 accepts recorded evidence only for pool exhaustion, while `init-perms-network-mode.ac2` in the draft xBRIEF accepts all four. This leaves a build, pull, or external-network failure with conflicting pass criteria. Make AC-2 name the same four inconclusive cases and require the error plus AC-1 output for each.

## sharpens-framing: Migration example loses the network condition

The PRD's Docker-skill instruction at `.pan/drafts/pan-4663.md`, lines 309–317, recommends `network_mode: none` for a migration **that needs no network**. The draft xBRIEF's `network-rule-docs` action drops that condition and says to use it for “a chown or migration.” A migration that connects to a database needs a network, so following the xBRIEF literally would produce misleading user guidance. Carry the “that needs no network” condition into the xBRIEF action.
