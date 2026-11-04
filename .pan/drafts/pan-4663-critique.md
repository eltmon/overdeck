plan-digest: 6753ab690df4dfe41a7c4154a6512ddcaf7b54becc9f4815abf0754c6f03fb3f

## blocks-the-design: Guard accepts empty networks

Evidence: The proposed predicate in `.pan/drafts/pan-4663.md`, lines 228–235, accepts any service with a `networks` key. Running `printf 'name: probe\nservices:\n  bare:\n    image: busybox\n    networks: []\n' | docker compose -f - config --format json` produced a `default` network and attached `bare` to it. `networks: {}` did the same. Thus the guard can pass while the extra subnet returns, contrary to FR-2 at lines 121–122. Require a nonempty, non-`default` network declaration or a valid `network_mode` in the guard, and update FR-3 to cover empty network declarations.

## sharpens-framing: Network rule needs a scope

Evidence: The proposed skill text in `.pan/drafts/pan-4663.md`, lines 277–282, says every Compose service must declare `networks` or `network_mode`, and that otherwise Compose creates an *extra* network. The same PRD, lines 103–107, correctly treats the implicit `_default` as the sole network in `docker/pan-workspace/docker-compose.yml`, whose service has neither key (lines 4–18). Scope the skill rule and its “extra network” explanation to stacks that already declare another network; allow an intentional default-only stack.

## sharpens-framing: Scratch create has other failure modes

Evidence: The live checkpoint in `.pan/drafts/pan-4663.md`, lines 190–210, accepts a `create` failure only for an exhausted subnet pool. Its scratch Dockerfile runs `curl -fsSL https://bun.sh/install` at `infra/.devcontainer-template/Dockerfile`, lines 13–15, and the Compose file also requires the external `overdeck` network (`infra/.devcontainer-template/docker-compose.devcontainer.yml.template`, lines 202–205). A fresh or offline host can fail before the network count is observed, even with the fix correct. State how the checkpoint treats build, registry, or missing-external-network failures as inconclusive, with the normalized `docker compose config` check as the fallback evidence.
