plan-digest: d799ff4ff48b4eedd5399e48c497c247e236b06b07a4c6478bcaeb34d5ef685b

## blocks-the-design: packaging proof can be skipped

The PRD's AC-3 (lines 254 and 270) accepts a scanner-only probe if the local end-to-end build fails for an environmental reason. The proposed unit tests exercise a fixture and pure helpers, not `prepare-server-resources.mjs` or `build-for-publish.mjs` together. `.github/workflows/ci.yml` builds the root project (lines 77-94) and packs `@overdeck/core`, but has no desktop staging or packing step; the real desktop build runs only in `.github/workflows/release.yml` (line 295 today). Thus a miswired skip, forbidden-package guard, or size check can pass every PR gate and fail only after a release tag is pushed. The smallest fix is to make one real desktop staging and `npm pack` measurement a required pre-merge acceptance check. If the local environment blocks it, run that check in CI or another clean runner; do not count the scanner probe as equivalent proof.

## sharpens-framing: half-release claim exceeds the gate

The new `Build desktop package` step sits in the `npm` job, but `.github/workflows/release.yml` runs the `desktop` matrix independently (lines 314-318 and 397-415), and the GitHub Release waits for both jobs. A macOS or Windows installer failure can therefore occur after the npm job publishes all three packages, leaving no GitHub Release. The PRD's D6 says the change prevents “no half-release” without this boundary. Limit that claim to failures of the npm-job packaging guards, or make `npm` depend on successful desktop builds if avoiding every desktop-build half-release is required.
