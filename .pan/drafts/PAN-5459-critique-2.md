plan-digest: 516ad81fe641aef279053f4d7f914c71553f95564eb09aacf3727bc8c765a832

## blocks-the-design: Pressure sample precedes the decision

PRD lines 193–197 and xBRIEF `nslots-pressure-waits` replace the first negative window with `samplePressure.mock.calls.length > 0`. In `src/lib/cloister/quality-gate-admission.ts` lines 861–865, the loop calls and awaits `samplePressure()` before it checks `pressure.pressured` and reports a CPU wait. The mock call count can therefore become positive while that decision is still pending; `secondResolved === false` and the absent slot file can pass before the tested block has happened. The subsequent sample count is taken only after releasing the first slot, so it does not fix that first assertion. Add `onWaiting` to the second request and wait for its first `{ kind: 'cpu' }` report before the first negative assertions. Keep the sample counter for the post-release ordering wait.

## blocks-the-design: Load liveness check accepts dead workers

PRD lines 438–446 and xBRIEF `final-load-verify` call `kill -0 $pids` to assert that every busy loop is alive. Bash returns success if any PID in a multi-PID `kill` succeeds: `bash -c 'kill -0 $$ 99999999 2>/dev/null; printf "mixed_exit=%s\n" "$?"'` printed `mixed_exit=0`. Thus some or almost all load processes may die while all ten runs still satisfy the scripted acceptance criterion, contrary to PRD line 453. Check each PID separately before and after every run, failing on the first dead process.
