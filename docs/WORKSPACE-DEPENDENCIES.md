# Workspace Dependency Isolation

**How Panopticon workspaces manage Node.js dependencies independently from the host and from each other.**

---

## Architecture

Each workspace is a git worktree at `workspaces/feature-<issue-id>/`. Host and container environments run **completely separate** `node_modules` — they never share or symlink dependencies.

```
Main repo (host)
├── node_modules/          ← host's own deps (bun install)
├── packages/contracts/    ← workspace package (source of truth)
└── workspaces/
    └── feature-pan-451/
        ├── node_modules/  ← worktree's own deps (bun install)
        ├── packages/contracts/  ← worktree's own copy (git worktree)
        └── .devcontainer/
            └── docker-compose.devcontainer.yml
                └── container-node-modules volume  ← container's own deps
```

### Why Not Symlink?

Previous versions symlinked `workspaces/feature-xxx/node_modules → main repo/node_modules`. This broke local workspace package resolution:

- `@panopticon/contracts` is defined in `packages/contracts/` with `workspace:*` specifier
- Bun resolves `node_modules/@panopticon/contracts` as a symlink to `../../packages/contracts/`
- With symlinked node_modules, this resolved to the **main repo's** `packages/contracts/`, not the worktree's
- When an agent modified contracts in a worktree, typecheck still saw the main repo's stale build

### The Three Layers

| Layer | Location | Package Manager | When Installed |
|-------|----------|----------------|----------------|
| **Host (main repo)** | `/path/to/project/node_modules` | `bun install` | Developer runs manually |
| **Host (worktree)** | `workspaces/feature-xxx/node_modules` | `bun install` | Workspace creation |
| **Container** | Named Docker volume `container-node-modules` | `bun install` (in init service) | `docker compose up` |

Each layer is completely independent. Changes in one never affect the others.

---

## Project Configuration

In `~/.panopticon/projects.yaml`, projects declare their package manager and workspace packages:

```yaml
projects:
  panopticon-cli:
    package_manager: bun        # bun | npm | pnpm
    workspace_packages:         # local packages that need building
      - path: packages/contracts
        build_command: npm run build
```

### `package_manager`

Determines which command runs during workspace creation and before verification gates:
- `bun` → `bun install` (~2 seconds via hardlinks from global cache)
- `npm` → `npm install`
- `pnpm` → `pnpm install`

If omitted, Panopticon auto-detects from lock files (`bun.lock` → bun, `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm).

### `workspace_packages`

Local packages that need building before quality gates run. Each entry specifies:
- `path` — relative to workspace root (e.g., `packages/contracts`)
- `build_command` — command to build the package (e.g., `npm run build`)

The verification gate runs `bun install` + builds all workspace packages before typecheck/lint/test. This ensures agents' contract changes are compiled before quality gates check them.

---

## Docker Container Isolation

Workspace containers use a **single named volume** for the root `node_modules/`:

```yaml
volumes:
  - ../:/workspaces/panopticon:cached          # Project files from host
  - container-node-modules:/workspaces/panopticon/node_modules  # Container's own deps
```

### How It Works

1. The project source is mounted from the host via bind mount (`../:/workspaces/panopticon`)
2. The root `node_modules/` is shadowed by a Docker named volume (`container-node-modules`)
3. An `init` service runs `bun install` inside the container, populating the volume
4. The init service also builds workspace packages (`packages/contracts`)
5. Frontend and server services depend on init completing successfully

### Why Single Volume?

Bun hoists all workspace dependencies to the root `node_modules/`. Per-workspace `node_modules/` directories (for `src/dashboard/frontend/`, etc.) are mostly empty — Bun resolves everything from root. A single volume for root is sufficient.

### Container Image

The container uses `node:22-alpine` with Bun installed system-wide. Node 22 is required because:
- Bun's `.bun/` hoisted package layout uses module resolution features not available in Node 20
- The `tsdown` build tool requires Node 22+ for its dynamic import resolution

---

## Workspace Creation Flow

When `pan workspace create` runs (or when the planning dialog creates a workspace):

1. **Create git worktree** — `git fetch origin && git worktree add`
2. **Install dependencies** — `bun install` in the worktree root
3. **Build workspace packages** — e.g., `cd packages/contracts && npm run build`
4. **Install skills & templates** — Panopticon skills, CLAUDE.md, project templates
5. **Start Docker containers** (if `--docker` flag) — runs init service which installs deps independently

Steps 2-3 ensure the worktree has its own `node_modules` with correct workspace package resolution before any agent or quality gate runs.

---

## Verification Gate

Before quality gates (typecheck, lint, test) run, the verification runner:

1. Reads `package_manager` from `projects.yaml`
2. Runs `bun install` (or npm/pnpm) in the workspace
3. Builds all `workspace_packages` entries
4. Then runs the configured quality gates

This ensures agents' dependency changes are properly installed and workspace packages are built, even if the agent forgot to run these steps.

---

## Teardown & Cleanup

When workspaces are removed (close-out, deep-wipe):

1. **Docker containers** are stopped via `docker compose down`
2. **Orphaned host processes** (Vite dev servers, node processes) are killed — these survive Docker teardown and can exhaust inotify watchers
3. **Git worktree** is removed (which removes the worktree's `node_modules`)
4. **Docker volumes** are removed with `docker compose down -v`

---

## For Other Projects

This dependency isolation model applies to any Panopticon-managed project:

1. Set `package_manager` in `projects.yaml` to match your project
2. If you have local workspace packages, list them in `workspace_packages`
3. Your Docker compose template should shadow `node_modules` with a named volume
4. The init service should run your package manager's install command
5. Never symlink `node_modules` between worktrees or between worktree and main repo

Projects without Docker containers (no `--docker` flag) only need steps 1-2. The host-side `bun install` during workspace creation handles everything.
