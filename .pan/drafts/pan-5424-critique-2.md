plan-digest: 332b98fcaf1384d90d2607d361975705ad9e34f21034919061ab3ed8bb4bd30b

## sharpens-framing: fallback size message has missing fields

The PRD requires the size message to include unpacked MB and file count (`.pan/drafts/pan-5424.md`, line 193), but its real-pack fallback returns only `{ size: statSync(tgz).size }` (line 200). A checker following both instructions can print `NaN MB` and `undefined files` when the fallback runs, even if the size decision is correct. Specify `unknown` for unavailable metadata, or retain valid metadata from the dry-run result, and include that case in the tests.

## sharpens-framing: changelog promises an independent release job

The proposed changelog says the fix makes the GitHub Release ship and that the desktop app “no longer bundles” the machine-learning runtime (`.pan/drafts/pan-5424.md`, line 245). The plan explicitly keeps the bundled transformers chunk (lines 93–97) and leaves the installer matrix independent; `.github/workflows/release.yml` has `desktop` needing only `classify` (line 315), while `release` needs both `npm` and `desktop` (lines 414–415). The fix removes the staged onnxruntime dependency and prevents this npm packaging failure before publishing; an installer failure can still prevent the GitHub Release. Change the changelog bullet to state those narrower effects.
