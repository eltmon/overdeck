# PAN-336: Unify Verification Gate into Quality Gates System

## Current Status: IMPLEMENTATION COMPLETE

## Summary

Three failures exposed during MIN-779: planning was skipped, verification gate ignores polyrepo paths, and test agent doesn't baseline against main. Root cause is two parallel code paths for running checks (`runVerificationGate` with hardcoded commands vs `runQualityGates` which reads config).

## Tasks

### Task 1: Delete verification-gate.ts, extend runQualityGates
- Delete `src/lib/cloister/verification-gate.ts`
- Add SSH/remote workspace support to `runQualityGates` in `validation.ts` (port from verification-gate.ts)
- Add DEFAULT_GATES fallback when no quality_gates config exists in projects.yaml
- Defaults: typecheck (`npm run typecheck`), lint (`npm run lint`), test (`npm test`)

### Task 2: Update verification-runner.ts
- Replace `runVerificationGate()` call with `runQualityGates()`
- Load gates config from projects.yaml for the workspace's project, fall back to DEFAULT_GATES
- Adapt `QualityGateResult[]` to produce output compatible with feedback writing and agent messaging
- Preserve cycle counting, circuit breaker, feedback file writing

### Task 3: Fix planning enforcement
- Audit `pan work issue` CLI path — ensure PRD/beads check matches dashboard start-agent endpoint
- Block or auto-trigger planning when no PRD exists

### Task 4: Fix test baseline
- Before running tests on feature branch, run same test command on main (or use cached result)
- Only flag failures NEW relative to main
- Don't attribute pre-existing failures to current issue

### Task 5: Add tests
- Unit tests for unified quality gates with polyrepo paths
- Unit tests for DEFAULT_GATES fallback behavior
- Test that verification-runner produces correct feedback format

## Remaining Work

None — all tasks complete. Tests pass (135/135).
