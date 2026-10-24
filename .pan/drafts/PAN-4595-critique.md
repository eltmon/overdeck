plan-digest: 09858c7f0fdf3de6c62b441a81a4df34168b0b8983bb1ffd8d393d5210155904

## sharpens-framing: Bundle scan does not identify the CLI path

The PRD WI-4 and xBRIEF acceptance criterion accept any top-level `dist/*.js` containing `getRuntimeForAgent(agentId)?.getHeartbeat(agentId)`. But `tsdown.config.ts:12-23` builds several independent top-level entries, including `index`, `supervisor/server`, and the host processes alongside `cli/index`. A `FOUND` result can therefore come from another entry and does not establish that `pan show` loads the registration. The current checkout has no `dist/`, so I checked the build entry configuration and the exact scan predicate in PRD WI-4. Make the built-CLI scratch-home run mandatory for acceptance, or check the CLI entry's transitive output chunks specifically; do not let the checkpoint fall back to this scan alone.

## sharpens-framing: Health loads the registrar but is not one

`src/lib/runtimes/index.ts:160-165` calls `registerLivenessHeartbeatLookup`; the proposed `src/lib/health.ts` change only imports that module. FR-5 and the xBRIEF documentation item call `health.ts` a "second registrar," which could make the comments describe a second registration that does not exist. Say that `health.ts` loads the registry for its registration side effect, and reserve "registrar" for `runtimes/index.ts`.

## footnote: Fixed test ID can read a real heartbeat

PRD WI-2 uses the fixed ID `agent-pan-4595-heartbeat-test` and says it must not collide with a real heartbeat. `src/lib/runtimes/claude-code.ts:187-205,247-255` reads `~/.overdeck/heartbeats/<agentId>.json` before the transcript, outside `OVERDECK_HOME`. A matching fresh file would invalidate the transcript-specific assertions. Derive a unique agent ID from the temporary directory for each test, or isolate the heartbeat home in the test.
