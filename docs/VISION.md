# Panopticon Product Vision

**Deployment model roadmap and architectural principles.**

---

## Current State (2026)

Panopticon runs as a **single-developer local Electron app** on individual developer machines. The dashboard, SQLite database, agent orchestration, and git worktrees all live on the same machine. Fly.io is used only for AI agent workspaces (to offload RAM, CPU, and disk), not for hosting the dashboard itself.

### Why local-first?
- Source code never leaves the developer's machine.
- No network latency for git operations, file search, or terminal interaction.
- Works offline (agent workspaces excepted).
- No authentication, tenancy, or data-isolation complexity.

---

## Vision Roadmap

### Phase 1 — Shared Instance
A single Panopticon instance used by a development team.

- One long-running dashboard on a team server or shared VM.
- Agents still execute in isolated per-developer Fly.io workspaces.
- Git operations still happen locally on each developer's machine via git remotes.
- Authentication is lightweight (e.g., team VPN + basic auth), not full multi-tenancy.

**Implications for infrastructure decisions:**
- Webhook relay (smee.io) remains acceptable for now, but the system should accept direct webhooks when a shared instance has a public URL.
- SQLite may need to migrate to PostgreSQL for concurrent team access.
- File-system paths (`~/.panopticon/`, workspace directories) need to be configurable per deployment.

### Phase 2 — Multi-Tenant SaaS
A fully hosted Panopticon service.

- Dashboard, database, and workspace provisioning are all managed by Panopticon Inc.
- Full tenant isolation (auth, billing, data boundaries).
- Webhooks received directly — no smee.io relay.
- Workspaces may run on Panopticon-managed infrastructure or connect to customer VPCs.

**Implications for infrastructure decisions:**
- All paths, secrets, and service endpoints must be injectable via configuration.
- No hard-coded assumptions about `localhost`, `~/.panopticon/`, or single-user file permissions.
- Cost tracking and resource metering must be tenant-aware.

---

## Guiding Principle

> Design for the current local model, but don't paint ourselves into a corner for the shared/SaaS future.

When making infrastructure decisions (webhooks, networking, auth, storage), prefer approaches that work today and degrade gracefully toward multi-tenancy:

| Area | Local Today | Shared/SaaS Future |
|------|-------------|-------------------|
| **Dashboard server** | `localhost` + Electron | Public HTTPS endpoint |
| **Database** | SQLite (single process) | PostgreSQL (concurrent) |
| **Webhooks** | smee.io relay | Direct delivery |
| **Auth** | None (local-only) | OAuth / SSO |
| **Workspace infra** | Fly.io (personal account) | Panopticon-managed or BYOC |
| **File storage** | `~/.panopticon/` | S3-compatible object store |
| **Config** | `projects.yaml` + env vars | Tenant-scoped config API |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-28 | Articulated three-phase vision | Needed shared context for infra PRDs (webhooks, auth, storage) |
