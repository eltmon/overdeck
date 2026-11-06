plan-digest: 6d8a667bcc7dcf519828257cf4385648ebc3b555fc812287a2d1913a72a6cf05

## blocks-the-design: The adoption filter excludes real container installs

Evidence: The PRD says a user self-hosting on Fly is a real user (`.pan/drafts/pan-5084.md`, line 86), and FR-8 classifies an install with `/.dockerenv` or `/run/.containerenv` as `container` (line 43). Yet its after-deploy instruction restricts usage dashboards to `install_kind = user` (line 450). A real Docker or Podman install would send events, then disappear from the adoption dashboards that this issue aims to repair. Change the dashboard filter to include `container` alongside `user`, while excluding the known test kinds, or explicitly decide and document why real container deployments are outside the adoption measure.

## blocks-the-design: A failed Docker probe hides a Podman marker

Evidence: WI-2's specified resolver puts `probe.exists('/.dockerenv') || probe.exists('/run/.containerenv')` inside one `try` (`.pan/drafts/pan-5084.md`, lines 174-177). If the first probe throws, the second is never called and the resolver returns `user`, even when `/run/.containerenv` exists. That violates FR-8's “or” classification (line 43); the planned tests cover both probes throwing, but not one throwing while the other succeeds (line 189). Catch each existence probe separately and add that mixed-failure test.
