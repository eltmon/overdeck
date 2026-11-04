plan-digest: e59733a008f491d48f04e3a70dd02f9fddd03ebc6a8cc7f700111349bde3f30f

## blocks-the-design: Compose mode changes under a restrictive umask

The PRD requires preserving the original mode (FR-1, line 32), but its proposed `writeFileSync(tmpPath, after, { mode: statSync(composePath).mode & 0o777 })` (line 103) applies the process umask when creating the temp file. I reproduced the exact write/rename with an original mode of `0o640` and `process.umask(0o077)`; the replacement mode was `0o600`. The proposed mode test runs under the normal test umask, so it misses this. Preserve the mode with `chmodSync(tmpPath, originalMode)` before rename, and test the restrictive-umask case (restoring the umask afterward).

## blocks-the-design: A failed container check still skips Traefik startup

FR-3 says `docker compose up -d` runs after a migration throw unless the container is already running (PRD line 34). In the proposed helper, `docker ps` and `docker compose up -d` share the second try/catch (PRD lines 164-172). If the `docker ps` command rejects, the helper returns `failed` without attempting `docker compose up -d`, even though it has not established that the container is running. Give the container check its own catch and attempt `up -d` when the check fails; add that case to the `pan up`-shape tests.

## blocks-the-design: IPv6 reachability claim ignores preserved port mappings

The proposed DASHBOARD-AUTH replacement says IPv6 LAN clients cannot connect (PRD lines 377-378), and the guide says Overdeck publishes on IPv4 only (line 392). The migration rewrites only mappings whose host and container ports are the same 80, 443, or 8080 (`src/lib/traefik.ts:245-255`). Its existing test explicitly preserves an unqualified `8443:443` mapping (`tests/lib/traefik.test.ts:78-80,118-123`). Docker publishes mappings without a host address on both IPv4 and IPv6 ([Docker port publishing docs](https://docs.docker.com/engine/network/port-publishing/), “Setting the default bind address”). Scope the statements to the three managed port lines and remove the categorical claim that IPv6 clients cannot connect; additional compose mappings can still expose Traefik.

## sharpens-framing: Timeout test uses the forbidden real-timer pattern

The new after-timeout test deliberately calls `listen(50)` and waits for the real timer (PRD lines 329-348), while `sync-sources/rules/fake-timers-for-retry-tests.md:8-10,36` requires fake timers for delay-based tests and places unavoidable real-time I/O tests in a separate `@slow` file outside the default run. The existing socket test does not make the new test an exception. Test the hold timer with `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()` using a request/response test double, keeping the existing socket coverage for integration behavior.
