plan-digest: 662ec15772c1c7769007567f84541c713cd601874832d55362d82d13d282f30f

## blocks-the-design: Fallback cannot satisfy the plan's acceptance criteria

The PRD's implementation checkpoint ([`.pan/drafts/PAN-5654.md`](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/.pan/drafts/PAN-5654.md), line 40) authorizes dropping the Gradle offline wiring and using an `actions/cache` plus Maven prefetch instead. But FR-1 through FR-4 (lines 44–47) still require that wiring and the no-`~/.m2` guard; AC-1, AC-3, AC-4, AC-5, and AC-6 (lines 167–172) still test it. The draft xBRIEF repeats this contradiction: WI-1 and WI-3 permit the fallback while their acceptance children still require `robolectricRuntime`, `fetchRobolectricRuntime`, `robolectric.offline`, and the `~/.m2` guard. The fallback would put the jar in the very directory FR-4 forbids, so an implementer following the permitted fallback cannot complete or honestly close the plan.

Smallest fix: make fallback activation a checkpoint that stops for plan revision before code work continues, or give the fallback its own requirements and acceptance criteria and say exactly which primary criteria it replaces.
