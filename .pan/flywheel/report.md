# Flywheel report (2026-11-17, loop stopped idle)

## Shipped this run (2026-11-15 to 2026-11-17)
- Workflow redesign book (epic PAN-5284, closed by its owner): every child merged, deployed and live-checked, including C, G, D2, H (all-projects deck), PAN-5335, 5370, 5371, 5391, 5408, 5414, 5418, 5413, 5341, 5427.
- Safe shutdown PAN-5342 (operator live checks pending), pan open PAN-5349 + phantom-deck fix PAN-5398, Send now PAN-5353, toast-click PAN-5423.
- React 19 + React Compiler PAN-4561, shared Modal PAN-4756.
- Semgrep: gate PAN-4590 (advisory default), in-session PAN-4591, ci-setup PAN-4592, dashboard settings PAN-4594.
- pan computer PAN-5452; Anywhere billing PAN-4294 (code merged; Workers deploy is operator-only; changelog entry held in .pan/notes/held-changelog/).
- Memory: PAN-5358, 5359, 5360; okf publish OKF-11 + re-vendor v0.1.1 PAN-5402.
- Releases: v0.87.0, v0.87.1, v0.88.0 (v0.87.2 cut by the epic owner conversation), each verified with a clean npx install.

## Substrate fixes driven
- PAN-5354 resume agents killed by a host crash; PAN-5356/5357 train rebuild + sequencer churn; PAN-5361 bare-host flake; PAN-5363/5364 train board; PAN-5369 dashboard 100% CPU; PAN-5394/5459 admission-test flakes (whole file); PAN-5395 single-repo start refusal; PAN-5396 free merged agents (confirmed live); PAN-5401 comment verdicts at close-out; PAN-5424 desktop package size; PAN-5432 rag-runs test race.

## Parked / waiting on the operator
- PAN-4593 Semgrep Platform tier (offer Guardian? contact Semgrep first?).
- PAN-4294 Workers deploy; PAN-5342 four live checks; PAN-5241 spend cap amount; author gate for overdeck-agent[bot]; GitHub App Issues permission; AAB upload; overdeck-landing#7 merge; Grok retest.
- July hardening book (PAN-3288, 3290, 3297): queued but never started, issues not released.
