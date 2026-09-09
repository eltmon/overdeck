# Prime Agent No-Loss Audit

Every existing harness remains present while `prime-agent` gains an explicit home. The mechanical test reads each canonical surface below.

| # | Surface | Canonical location | Prime disposition | Existing harnesses preserved | Verified |
|---|---|---|---|---|---|
| S1 | Harness union and known set | `packages/contracts/src/types.ts` | explicit literal | yes | [x] |
| S2 | Behavior map | `packages/contracts/src/harness-behavior.ts` | `PRIME_AGENT_BEHAVIOR` | yes | [x] |
| S3 | Config harness schema | `src/lib/config-yaml/schema.ts` | accepted role/provider harness | yes | [x] |
| S4 | CLI help and composer manifest | `src/cli/index.ts`, `packages/contracts/src/composer-commands.generated.ts` | listed | yes | [x] |
| S5 | Provider resolution | `src/lib/prime-agent/provider-map.ts` | strict table, no fallback | unchanged | [x] |
| S6 | Runtime registry | `src/lib/runtimes/index.ts` | registered adapter | yes | [x] |
| S7 | Artifact, telemetry, flywheel, context preview | `packages/contracts/src/{artifacts,telemetry,flywheel,context-layers}.ts` | explicit literal | yes | [x] |
| S8 | Transcript registry | `src/lib/conversations/transcript-adapter.ts` | Prime adapter | yes | [x] |
| S9 | Cost source | `src/lib/overdeck/cost.ts` | `prime_agent` source | yes | [x] |
| S10 | Context renderer | `src/lib/context-layers/harness.ts` | Prime marker and artifact | yes | [x] |
| S11 | Work/conversation lifecycle | `src/lib/agents/runtime-command.ts`, `src/lib/overdeck/conversation-runtime.ts` | persistent RPC | yes | [x] |
| S12 | Delivery and recovery | `src/lib/prime-agent/{session-controller,session-resume}.ts` | correlated RPC and strict resume | unchanged | [x] |
| S13 | Dashboard API and frontend | `src/dashboard/` | identity, activity, usage, picker, badges, filters | yes | [x] |
| S14 | Operator documentation | `configuration/harnesses.mdx`, `configuration/context-layers.mdx` | setup and boundary documented | yes | [x] |
