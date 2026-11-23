---
type: project
description: Restarting a feature workspace's frontend/server containers with
  plain docker restart (not docker compose) can corrupt the shared
  container-node-modules volume, breaking vite
created: 2026-11-23
updated: 2026-11-23
---

Plain `docker restart overdeck-feature-<issue>-frontend-1` (bypassing docker compose)
left the frontend container's `bun run dev` unable to find `vite` (`vite: command not
found`, exit 127) on PAN-5609, even though the SAME named volume had worked for 5 hours
before the restart. The named volume `container-node-modules` (mounted at
`/workspaces/overdeck/node_modules` inside frontend/server/init) ended up with only 63
entries, missing `.bin/vite`, after the restart.

Two compose files share the name `docker-compose.devcontainer.yml`: one at the workspace
root (`docker-compose.devcontainer.yml`, wrong — its `../` resolves one directory too far
up) and the real one at `.devcontainer/docker-compose.devcontainer.yml` (its `../` resolves
to the workspace root). Running `docker compose run init` from the wrong file fails with
"Bun could not find a package.json file to install from".

**Why:** cost real debugging time diagnosing why a dev container broke mid-task; the
instinct to `docker restart` a stuck/stale-looking workspace container directly is wrong.

**How to apply:** to pick up new code in a feature workspace's own containers, prefer
`npm run build` on the host (bind-mounted into `server`), then from
`workspaces/<feature>/.devcontainer/`, run
`docker compose -f docker-compose.devcontainer.yml run --rm init` (reinstalls deps + rebuilds
dashboard server into the shared volume) followed by
`docker compose -f docker-compose.devcontainer.yml up -d frontend server`. Never plain
`docker restart` these containers, and never use the top-level
`docker-compose.devcontainer.yml` copy.
