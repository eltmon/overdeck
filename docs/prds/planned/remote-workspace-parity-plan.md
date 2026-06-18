# PRD: Remote Workspace Full Parity with Local

## Problem Statement

Remote workspaces on exe.dev are not fully functional compared to local workspaces. When migrating or creating a remote workspace, only the code and planning state are transferred - the services (API, frontend) don't actually run because:

1. Runtime dependencies (Java, Node) aren't installed
2. Applications aren't built
3. Services aren't started
4. Frontend isn't configured to point to workspace's own API
5. Ports aren't properly exposed

This defeats the purpose of remote workspaces - they should be **immediately usable** after creation/migration.

## Goals

1. Remote workspaces should be fully functional immediately after creation
2. `pan workspace create --remote` should result in running services accessible via URLs
3. `pan workspace migrate --to-remote` should preserve full functionality
4. Zero manual intervention required to get a workspace running

## Current State

- ✅ Code cloned to VM
- ✅ Planning state (.planning/, beads) copied
- ✅ Credentials synced (Claude, GitHub, GitLab)
- ✅ Vite allowedHosts configured for exe.xyz
- ❌ Runtime dependencies not installed (Java, specific Node versions)
- ❌ Applications not built
- ❌ Services not started
- ❌ Frontend API URL not configured for workspace
- ❌ Ports not exposed for external access

## Critical Constraint: exe.dev Single Port

**exe.dev only exposes ONE port per VM** via their share feature. This is a fundamental architectural constraint.

A typical workspace needs:
- Frontend: port 4173 (Vite preview)
- Backend API: port 5000/7000/8080
- (Optional) Database UI, etc.

**Solution: nginx reverse proxy**
- All external traffic goes through one port (8080)
- nginx routes `/api/*` → backend, `/*` → frontend
- Frontend built with same-origin API URL (no port)
- CORS simplified (same origin)

```
┌─────────────────────────────────────────────────────────┐
│  exe.dev VM                                             │
│                                                         │
│  https://vm-name.exe.xyz (port 8080)                   │
│         │                                               │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   nginx     │                                        │
│  │  (port 8080)│                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│    ┌────┴────┐                                          │
│    │         │                                          │
│    ▼         ▼                                          │
│  /api/*    /*                                           │
│    │         │                                          │
│    ▼         ▼                                          │
│ Backend   Frontend                                      │
│ (5000)    (4173)                                        │
└─────────────────────────────────────────────────────────┘
```

## Technical Approach

### Phase 0: Reverse Proxy Setup (NEW)
- Install nginx on VM (if not present)
- Configure nginx to route:
  - `/api/*`, `/ws-stomp/*`, `/docs/*` → backend (localhost:5000)
  - `/*` → frontend (localhost:4173)
- Set exe.dev share port to nginx port (8080)
- Make share public for external access

### Phase 1: Runtime Environment Setup
- Detect project type (Spring Boot, Node, etc.) from project files
- Install required runtimes (Java via SDKMAN, Node via fnm)
- Cache installations across VMs where possible

### Phase 2: Application Build
- For Spring Boot: `./mvnw package -DskipTests`
- For Node/Vite: `pnpm install && pnpm build`
- **Important**: Build frontend with `VITE_PUBLIC_API_HOST` set to same-origin URL (no port)
- Handle polyrepo (multiple apps) vs monorepo

### Phase 3: Service Startup
- Start services via docker-compose or direct execution
- Configure environment variables for workspace isolation
- Handle service dependencies (start API before frontend if needed)
- **API CORS must allow `*.exe.xyz` origins**

### Phase 4: Frontend API Configuration
- Detect frontend framework (Vite, CRA, Next.js)
- Configure API URL to point to **same origin** (not localhost:PORT)
- This enables nginx routing without CORS issues

### Phase 5: Port Exposure
- Set exe.dev share port to nginx (8080)
- Make share public: `ssh exe.dev share set-public <vm>`
- Single URL serves both frontend and API
- Update workspace metadata with accessible URL

## Project-Specific Configuration

Projects can define their remote workspace requirements in `overdeck.projects.yaml`:

```yaml
myn:
  workspace:
    type: polyrepo
    # nginx reverse proxy config (required for exe.dev single-port limitation)
    proxy:
      port: 8080
      routes:
        - path: /api
          upstream: http://localhost:5000
        - path: /ws-stomp
          upstream: http://localhost:5000
          websocket: true
        - path: /docs
          upstream: http://localhost:5000
        - path: /
          upstream: http://localhost:4173
    repos:
      - name: api
        runtime: java:21
        build: ./mvnw package -DskipTests
        start: docker compose up -d
        port: 5000
        cors:
          - "https://*.exe.xyz"
      - name: fe
        runtime: node:20
        build: pnpm install && pnpm build
        start: pnpm preview --host 0.0.0.0 --port 4173
        port: 4173
        env:
          # Same-origin - nginx handles routing
          VITE_PUBLIC_API_HOST: "${WORKSPACE_URL}"
```

Note: `${WORKSPACE_URL}` is replaced at build time with `https://vm-name.exe.xyz`

## Success Criteria

1. `pan workspace create MIN-XXX --remote` results in accessible frontend URL
2. Frontend can successfully call the workspace's own API
3. Full development workflow possible on remote (edit → build → test)
4. Migration preserves all functionality from local workspace

## Implementation Checklist

### Code Changes Required in Overdeck

1. **`src/lib/remote/exe-provider.ts`** ✅ COMPLETE
   - [x] Add `setupNginxProxy(vmName, config)` method
   - [x] Add `setSharePort(vmName, port)` method
   - [x] Add `setSharePublic(vmName)` method
   - [x] Add `setupStandardWorkspaceProxy(vmName)` convenience method
   - [x] **Phase 1**: Add `detectProjectTypes()`, `installJava()`, `installNode()`, `installPnpm()`, `setupRuntimeEnvironment()`
   - [x] **Phase 2**: Add `buildMavenProject()`, `buildNodeProject()`, `buildAllProjects()`
   - [x] **Phase 3**: Add `startDockerCompose()`, `startVitePreview()`, `startAllServices()`
   - [x] Add `setupFullWorkspace()` method that orchestrates Phases 1-3 + nginx

2. **`src/cli/commands/workspace.ts`** and **`workspace-migrate.ts`** ✅ COMPLETE
   - [x] Call nginx setup after VM creation
   - [x] Configure exe.dev share port to nginx port
   - [x] Make share public automatically
   - [x] Install runtime dependencies (Java via SDKMAN, Node via fnm)
   - [x] Build applications (Maven, Vite with correct VITE_PUBLIC_API_HOST)
   - [x] Start services (Docker Compose, Vite preview)

3. **`src/lib/project-config.ts`** (new or extend existing)
   - [ ] Parse `overdeck.projects.yaml` workspace config (deferred - using auto-detection)
   - [ ] Generate nginx config from proxy routes (deferred - using standard config)
   - [ ] Detect CORS requirements (deferred - must be configured in project)

4. **Project Template Files**
   - [x] Default nginx config generated dynamically
   - [ ] Support project-specific overrides (deferred)

### Manual Fixes Still Required Per-Project

- CORS: Project must add `*.exe.xyz` pattern to CORS config (e.g., `CorsConfig.java`)
- This cannot be automated as CORS config varies by framework

## Out of Scope (for now)

- Hot reload/HMR on remote (nice to have, not critical)
- Database seeding/migration automation
- Multi-service orchestration (Kubernetes-style)
