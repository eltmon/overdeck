# PAN-4882 — issues filed

No check failed, so no D-4 failure issue was filed. Statuses: AC-4 passed, AC-6 passed, AC-15 passed; AC-2 relay
half and AC-3 relay (UDP blocked and TCP 443 only) not-run. The D-14 trigger did not fire (the proposed prefix
`PANANYWHER` is letters only), and the D-16 trigger could not fire (no relay dial time was measured).

Two issues were filed for findings outside the pass conditions:

- [#4885](https://github.com/eltmon/overdeck/issues/4885) — Anywhere re-run (PAN-4882): AC-4 pan worker run to an
  online Fly link fails on the 2.5 s secure-channel budget. Two of three `pan worker run` starts against an online
  Fly link failed with `Secure channel … did not open within 2500 ms` (`LINK_WAIT_MS`,
  `src/lib/anywhere/link-client.ts`). Evidence: `ac-04-fly-worker-lanes.md`, "Remote worker".
- [#4886](https://github.com/eltmon/overdeck/issues/4886) — Anywhere: run the PAN-4862 live relay check on Fly (not
  run in PAN-4862 or PAN-4882; needs an operator to approve one device code). Carries the replay recipe so the
  relay check is tracked after this issue closes. Evidence: `ac-02-03-relay.md`.
