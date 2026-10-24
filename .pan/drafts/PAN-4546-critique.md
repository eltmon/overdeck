plan-digest: 25b56cf2495dbd795d703890b00b44ed745abdb6c6a22d30cd75900569cc3f7c

## blocks-the-design: slot matcher aliases canonical paths

The PRD's WI-2 step 3 (`.pan/drafts/PAN-4546.md`, line 156) accepts every `/^slot-(\d+)\.json$/` name, while step 2 (lines 146-153) maps slot 0 only to `owner.json` and renders other indices in canonical decimal form. Thus `slot-0.json` is interpreted as slot 0, and `slot-01.json` as slot 1, although `clearStaleOwner(root, slot, ...)` in step 4 targets a different file. A stale or malformed alias remains in the admission directory, can count against capacity forever, and may cause a valid canonical owner to be cleared. Accept only canonical positive safe-integer slot names (for example `/^slot-([1-9]\d*)\.json$/` plus `Number.isSafeInteger`) and test that aliases cannot affect admission or reclaim.

## blocks-the-design: slot count varies by project

The PRD calls the admission queue machine-wide (`.pan/drafts/PAN-4546.md`, lines 13 and 25) and excludes per-project slot counts (line 251), but WI-3 reads `loadConfigNoMigration().config.resources.qualityGateSlots` (lines 184-196). That loader reads the project file selected by `process.cwd()` and the global file (`src/lib/config-yaml/load.ts`, lines 121-154 and 309-313); `mergeConfigs` applies project values after global values (`src/lib/config-yaml/merge.ts`, lines 298-302 and 841). Direct Vitest runs from different workspaces can therefore resolve different limits for the same admission directory. A project with 3 slots can admit three gates even when the operator's global setting is 1. Resolve this key from one machine-wide source for every caller, and test conflicting project and global values.

## blocks-the-design: requested Verification Gate documentation can be skipped

The PRD quotes the operator's requirement to update the CPU-admission paragraph in the Verification Gate section (`.pan/drafts/PAN-4546.md`, line 260), but WI-5 says to add nothing there if that paragraph is absent (line 227). The current section ends at `## Verification artifacts` on `docs/PIPELINE-GATES.md`, line 135; `rg -n 'admission' docs/PIPELINE-GATES.md` finds admission only at lines 903-904 and 920. As written, the likely outcome omits the requested explanation in the Verification Gate section. If the paragraph is absent at implementation time, add a dedicated CPU-admission paragraph there without editing the opening overview; otherwise update the existing paragraph.

## sharpens-framing: pressure fallback wording promises too much

WI-2 says a pressured sample blocks *every* new admission (`.pan/drafts/PAN-4546.md`, line 167), and preemption is excluded (line 249). Yet WI-5 asks the user-facing table and `CLAUDE.md` to say gates "run one at a time under pressure" (lines 231-232). If pressure rises after two gates start, both keep running; if one finishes while pressure remains, no replacement starts. State that pressure blocks new admissions and running gates keep their slots. The table should also mention the existing CPU-utilization threshold: `sampleQualityGatePressure()` returns pressured at utilization >= 0.75 even when PSI and load are low (`src/lib/cloister/quality-gate-admission.ts`, lines 110-129).
