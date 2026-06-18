# PAN-655: PRD Pipeline Test Marker

## Goal
Smoke-test the Overdeck planning → work → review → test → merge pipeline end-to-end, validating that PRD/STATE.md/vBRIEF artifacts land in canonical lowercase locations and survive close-out.

## Scope
Add a single new file: `docs/prd-pipeline-test-marker.md` containing the marker text from the issue body.

## Out of Scope
- Any code changes
- Any test changes (the file IS the test artifact)
- Any pipeline modifications

## Approach
Trivial single-file addition. The value is in exercising the pipeline, not the file content.

## Acceptance Criteria
1. `docs/prd-pipeline-test-marker.md` exists with the specified content
2. Planning artifacts land in `docs/prds/active/pan-655/` (lowercase)
3. After merge, artifacts move to `docs/prds/completed/pan-655/` and `~/.panopticon/archives/pan-655/`

## Difficulty
`trivial` — single file, exact content specified, no logic.

## Risks
None. Pure additive doc file.
