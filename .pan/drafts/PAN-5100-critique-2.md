plan-digest: ff708f89e3a8a2a26e5214f1646f159360332404198071b60bc478c985f974b8

## blocks-the-design: exceptions captured while telemetry is off

The PRD says `disableTelemetry()` sets `initialized = false` and clears the pending list (PRD lines 239-245), while `captureException()` queues any exception whenever `initialized` is false. After a fresh `effectiveEnabled: false`, a later phone crash is therefore queued during the known-off period; a later on answer flushes it to PostHog. The current door only drops exceptions while uninitialized (`src/dashboard/frontend/src/lib/telemetry.ts`, lines 167-169), so the new queue creates this behavior. Track `unknown` separately from `off`, queue only before consent is known, and add an off → crash → on test that sends no old exception.

## blocks-the-design: reconnect does not refresh consent

WI-6 starts `bootPhoneTelemetry` only from a `MachineView` mount effect with `[]` (PRD lines 269-287). The existing shell keeps that view mounted while link recovery runs (`apps/mobile/src/shell/ShellApp.tsx`, lines 259-275 and 412-427), and the connection phase already exposes recovery through `useConnectionState` (`src/dashboard/frontend/src/lib/connectionState.ts`, lines 48-74). If the first config read fails and cached telemetry is on, the phone keeps sending after the link recovers even if the machine is now off. This contradicts D-10's and WI-11's promise that off reaches the phone on its next successful connection. Re-read client config on link recovery, apply a fresh off before further captures, and test cached-on → failed read → recovered link → fresh-off.

## blocks-the-design: fresh config cannot replace cached properties

WI-6 initializes immediately from cached on, then says a fresh on answer stores the config and calls init only if not already initialized (PRD lines 269-286). WI-4 makes `initTelemetryFromConfig` return early while initialized, without re-registering properties (PRD lines 232-234). Thus a fresh on config with operator grouping now off leaves the cached `operatorHash` registered, although the existing door explicitly unregisters an absent hash to make that opt-out effective (`src/dashboard/frontend/src/lib/telemetry.ts`, lines 135-142). A changed install ID is likewise reported under the cached identity. Reconcile super properties on every fresh on answer, unregister an absent operator hash, and reset or reload the SDK when the machine identity or target changes. Test cached-on with a hash and old install ID → fresh-on without a hash and with a new install ID.
