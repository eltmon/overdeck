plan-digest: d98bca9819ce8212485761152ba48a40367ba894790518eaaedbd79cd5cee72f

## blocks-the-design: Install-once loses the afterEach hook

WI-2 stores one guard on `process` and returns without registering `afterEach` when the symbol already exists. In this repository, `vitest.config.ts:31,40,69` uses four fork workers and runs setup files for every test file. Vitest 4.1.11 resets modules before each file (`node_modules/vitest/dist/chunks/base.B6Opl8PE.js:82-90`), then clears the collector's default suite and its hooks (`node_modules/.bun/@vitest+runner@4.1.11/node_modules/@vitest/runner/dist/chunk-artifact.js:1653-1662,1880-1883`) before re-running setup files (`:2441-2451`). `afterEach` attaches to that suite (`:746-752`), so the hook from the first file does not carry into later files in the same fork. The guard wrapper remains on `process`, but a later test can catch its refusal and pass because no hook drains it. The proposed meta test calls the installer twice within one fake context, so it cannot detect this failure.

Keep the `process.kill` wrapper idempotent, but register the refusal-check hook for each test file's setup evaluation. Add a test that simulates two file-level hook contexts sharing one target and verifies that a swallowed refusal fails in the second context.
