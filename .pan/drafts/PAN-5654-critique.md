plan-digest: b6ad5d3f9b8e81d817d8a84aeb038ce1057aec08f25e640fb6ac807ac7b90c7f

## blocks-the-design: Fallback retries tests

The fallback in [the PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/.pan/drafts/PAN-5654.md), line 40, keeps a one-retry prefetch that “runs the Robolectric tests' class setup.” That invokes the test task twice on a failed first attempt, while NFR-2 at line 50 says no retry may hide a failing test and the existing CI test task runs once ([ci.yml](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/.github/workflows/ci.yml), lines 583–585). The fallback also gives no concrete prefetch command, so an implementer cannot distinguish a download failure from a test failure. Specify a fetch-only command that never executes tests and retry only that command; if no such command is available, make the checkpoint stop for plan revision instead of retrying test setup.

## sharpens-framing: Negative check expects a log message

AC-3 and WI-1 step 6 in [the PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/.pan/drafts/PAN-5654.md), lines 117 and 169, require the failed test to show `Unable to locate dependency`. I re-ran `javap -c -p org.robolectric.internal.dependency.LocalDependencyResolver` against the cached Robolectric 4.15.1 jar: `validateFile` passes that text to `Logger.error`, then throws `IllegalArgumentException` with `Path is not a file:`. Gradle may report the thrown text while keeping the log in the JUnit XML. State that the negative check should inspect the XML/log for the missing-dependency message or accept the thrown `Path is not a file:` error for the empty directory.

## sharpens-framing: One runtime jar covers one SDK

[PushNoticeTest.java](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/apps/mobile/android/app/src/test/java/ai/overdeck/app/PushNoticeTest.java), line 15, and [PushHandlerTest.java](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/apps/mobile/android/app/src/test/java/ai/overdeck/app/PushHandlerTest.java), line 30, both pin SDK 35, so the proposed single jar fits today. The documentation instruction in [the PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5654/.pan/drafts/PAN-5654.md), line 161, says to update the one `robolectricAndroidAllVersion` when changing *a test's* SDK. If only one test moves, the other still needs the SDK 35 jar and will fail. Say that all Robolectric tests must use the same pinned SDK with this setup, or add a runtime coordinate for each SDK in use.
