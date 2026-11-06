plan-digest: afcfb93cf5ac1e33da92dd73e7025b8485546037bda6dfed0a0a59c5e9098621

## blocks-the-design: Two throwaway dashboard harnesses remain live

WI-11 and FR-11 say every test server or CLI gets `OVERDECK_TELEMETRY=0`, but the file list omits [system-health-pill.spec.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5084/src/dashboard/frontend/tests/system-health-pill.spec.ts), lines 39–52, and [health-page.spec.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5084/src/dashboard/frontend/tests/health-page.spec.ts), lines 37–51. Both spawn `dist/dashboard/server.js` with a fresh home under the repository (`.tmp-pan-2647-*`) and inherit `process.env`. Outside CI, neither the proposed CI check nor the temporary-root check applies, so each server can still mint an install ID and send events. Add both files to WI-11, set `OVERDECK_TELEMETRY: '0'` in their child environments, and include them in its acceptance criterion.

## blocks-the-design: Temporary children beginning with two dots escape detection

WI-5 specifies `rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))` for containment. Running `node -e "const p=require('node:path'); const r=p.relative('/tmp','/tmp/..smoke-123'); console.log(r, r===''||(!r.startsWith('..')&&!p.isAbsolute(r)))"` prints `..smoke-123 false`. That home is inside `/tmp`, so the planned detector violates FR-2 and can emit telemetry. Reject only `rel === '..'` or `rel.startsWith('..' + sep)`, plus absolute paths, and test a child named `..smoke-123`.

## sharpens-framing: Resolver's no-throw guarantee excludes config reads

NFR-1 says telemetry resolution never throws to a caller, but WI-6's proposed `resolveTelemetryState()` still calls `loadConfigSync()` without a catch when `OVERDECK_TELEMETRY` is not off. The current call is likewise unguarded in [config.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5084/src/lib/telemetry/config.ts), lines 8–10; [service.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5084/src/lib/telemetry/service.ts), lines 213–219, catches it, while [settings-api-telemetry.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5084/src/lib/settings-api-telemetry.ts), lines 39–47, does not. State that NFR-1 covers only the new filesystem probes and preserves existing config-read failure behavior, or define a fail-closed result for a failed config read and test both Node and Settings callers.
