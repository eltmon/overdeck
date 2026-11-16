plan-digest: 7fbbb9e3754548aa06a44b418d0671618945719aafa29bc8de97966c6574ea9e

## footnote: no blocking findings

Checked `src/lib/memory/injection.ts` lines 494 and 535–544, `tests/lib/memory/injection.test.ts` lines 182–185 and 936–960, the query-expansion append at `src/lib/memory/query-expansion.ts` lines 245–254, and the fake-timer cleanup at test lines 399–435 and 539–570. The proposed poll addresses the verified fire-and-forget read race. The focused Vitest command could not reach the tests here: global setup attempted `build:cli`, whose Git subprocess was denied by this sandbox (`spawnSync git EPERM`).
