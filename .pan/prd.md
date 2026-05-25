# PAN-1205 — HTML Artifacts

**Issue:** [PAN-1205](https://github.com/eltmon/panopticon-cli/issues/1205)
**Parent epic:** [PAN-1200](https://github.com/eltmon/panopticon-cli/issues/1200)
**Status:** Planned
**Date:** 2026-05-18

---

## Problem

Panopticon agents today produce only text — diffs, markdown summaries, CLI output. Sometimes the best work product is visual and interactive:

- Side-by-side comparison of three options
- A dashboard showing test coverage trends
- A PR review page with embedded screenshots and annotations
- A timeline of a multi-week refactor
- A presentation that a non-technical stakeholder can click through
- A decision matrix

There's no way for an agent to produce, validate, share, or attach such an artifact to its workspace's record. The competing product Subspace has this capability, and it's effective; we should have it, and we should do it better.

## Goal

Add a first-class HTML artifacts capability:

1. `pan artifacts` CLI with `validate / create / publish / status / url / open / list / unshare`
2. **Real validation** (not just metadata): secret scanning, size enforcement, asset-path linting
3. **Isolated origins** for the wrapper page vs raw artifact (XSS/CSP boundary)
4. **Full provenance metadata** linking each artifact to its issue, agent, run, harness
5. Dashboard workspace inspector tab listing artifacts with thumbnails

## Design Goals

- **Self-contained files** — no external deps, no relative paths, no local assets
- **Tamper-evident** — content hash tracks edits; `pendingChanges` is automatic
- **Stakeholder-shareable** — `panopticon.localhost/s/<slug>` (with dashboard chrome) and `panopticon.localhost/a/<slug>` (raw, sandboxed) are first-class
- **Provenance-rich** — every artifact knows who made it, when, for which issue
- **Safe by default** — secret scanner catches accidental leaks; size cap enforced; assets locked down

## Architecture

### File Format Rules

Validated at `pan artifacts validate`:

| Rule | Enforcement |
|---|---|
| Single `.html` or `.htm` file | Hard (reject directory or non-HTML) |
| All CSS inline (`<style>` blocks) or in `style=` attrs | Hard (reject `<link rel="stylesheet" href="…">` with non-data: URL) |
| All JS inline (`<script>` blocks) | Hard (reject `<script src="…">` with non-data: URL) |
| Images: embedded SVG, data URLs, or HTTPS URLs | Hard (reject `./`, `../`, `/local/`, `file://`, `http://`) |
| Total file size ≤ 1 MB | Hard |
| No secrets in file body | Hard (regex match → reject) |
| Optional: strict mode | Soft (`--strict` flag enables additional checks) |

### Secret Scanner (Subspace has none)

Regex set:

| Pattern | Matches |
|---|---|
| `AKIA[0-9A-Z]{16}` | AWS access key ID |
| `ghp_[A-Za-z0-9]{36}` | GitHub PAT |
| `gho_[A-Za-z0-9]{36}` | GitHub OAuth token |
| `github_pat_[A-Za-z0-9_]{82}` | GitHub fine-grained PAT |
| `sk-ant-(api03|admin01)-[A-Za-z0-9_-]{86,}` | Anthropic API key |
| `sk-(proj-)?[A-Za-z0-9]{20,}` | OpenAI key |
| `xox[baprs]-[A-Za-z0-9-]{10,}` | Slack tokens |
| `-----BEGIN (RSA |OPENSSH |DSA |EC )?PRIVATE KEY-----` | SSH/TLS private keys |
| `(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}['"]` | Common .env-style assignments |
| High-entropy detector | Optional with `--strict`: Shannon entropy > 4.5 on 20+ char strings |

False positives are accepted; user can suppress per-line with `<!-- artifact-allow-secret -->` comment (and a warning is logged).

### CLI

```
pan artifacts validate <file>              # validate, no publish
pan artifacts validate <file> --strict     # additional checks (entropy, DOM hygiene)
pan artifacts create <file>                # validate + publish in one step
pan artifacts status <file>                # currentHash vs lastPublishedHash; pendingChanges
pan artifacts publish <file>               # re-publish after edits (require pendingChanges)
pan artifacts url <file>                   # print public URL
pan artifacts open <file>                  # open in browser via xdg-open
pan artifacts list                         # all artifacts visible to user
pan artifacts list --workspace <id>        # filtered to a workspace
pan artifacts unshare <file> --yes         # disable URL (keeps file + metadata)
pan artifacts diff <file>                  # show what differs from last published
```

All commands emit JSON when `--json` is passed (machine-readable for agents).

### Provenance Metadata

Every artifact entry in `~/.panopticon/artifacts/index.sqlite`:

```sql
CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,         -- ULID
  slug TEXT NOT NULL UNIQUE,            -- 8-char URL-safe, base32
  issue_id TEXT,                         -- 'PAN-1052' (nullable for user-authored)
  workspace_id TEXT,                     -- (nullable for user-authored)
  agent_role TEXT,                       -- 'work' | 'review' | etc.
  agent_harness TEXT,                    -- 'claude-code' | 'pi' | 'user'
  run_id TEXT,                           -- from PAN-1052's identity model
  session_id TEXT,
  file_path TEXT NOT NULL,
  current_hash TEXT NOT NULL,            -- SHA-256 of file contents
  last_published_hash TEXT,              -- nullable until first publish
  supersedes TEXT,                       -- previous artifact_id for the same logical thing
  title TEXT,                            -- extracted from <title> tag
  description TEXT,                      -- agent or user supplied
  created_at TEXT NOT NULL,
  published_at TEXT,
  unshared_at TEXT
);

CREATE INDEX artifacts_workspace ON artifacts(workspace_id);
CREATE INDEX artifacts_issue ON artifacts(issue_id);
CREATE INDEX artifacts_slug ON artifacts(slug);
```

Agents creating artifacts pass `--issue <id> --agent-role <role>` (or environment variables `PAN_ISSUE_ID`, `PAN_AGENT_ROLE` set by the spawn wrapper).

### Publishing Architecture

Dashboard serves two routes via Traefik:

| Route | Origin | Purpose | Auth |
|---|---|---|---|
| `panopticon.localhost/s/<slug>` | `panopticon.localhost` | Wrapper page: dashboard chrome, "Made by Bender for PAN-1052", comment thread, Open Artifact button | Inherits dashboard auth |
| `panopticon.localhost/a/<slug>` | `artifacts.panopticon.localhost` (separate Traefik route on a separate subdomain) | Raw artifact HTML, served in sandbox iframe via the wrapper | No auth; CSP `default-src 'self' 'unsafe-inline' data: https:` |

The separate origin prevents the artifact's JavaScript from accessing wrapper-domain cookies or localStorage. Traefik dynamic config:

```yaml
http:
  routers:
    panopticon-artifacts:
      rule: "Host(`artifacts.panopticon.localhost`)"
      service: panopticon-dashboard
      tls:
        certResolver: mkcert
    panopticon-dashboard:
      rule: "Host(`panopticon.localhost`)"
      service: panopticon-dashboard
      tls:
        certResolver: mkcert
```

The dashboard server serves both: `/a/<slug>` returns raw artifact HTML with strong CSP; `/s/<slug>` returns the wrapper page (React component embedding the iframe).

### Wrapper Page Content

`/s/<slug>` shows:

- **Header:** "Artifact: \<title>" + "Made by \<agent-role> via \<harness> for \<issue\> on \<date>"
- **Action row:** Open in new tab, Copy link, Share via tunnel (Phase 2), Unshare
- **Embed:** iframe `<iframe src="/a/<slug>" sandbox="allow-scripts allow-same-origin" />` (same-origin only allowed because the iframe is loading from a *different* origin already, so "same-origin" within the iframe doesn't grant access to the wrapper)
- **Comments:** simple thread (workspace context preserved); optional
- **Related artifacts:** other artifacts from the same workspace or issue

### Sandbox Isolation Verification

Test: create an artifact with JavaScript that does `try { document.cookie } catch (e) { … }` and `try { localStorage.getItem('x') } catch (e) { … }`. Embedding it in the wrapper page, the artifact's JS sees no cookies or storage from `panopticon.localhost`. Verified by Playwright assertion in integration test.

### Sharing Beyond localhost (Phase 2 placeholder)

`pan artifacts share --tunnel <file>` stub in v1 — prints "tunneling not yet supported in v1; see PAN-XXXX for Phase 2." Designed but not implemented to avoid scope creep.

## Dashboard Integration

New tab on the workspace inspector: **Artifacts**.

- Grid of cards, each showing:
  - Thumbnail (rendered server-side via Playwright headless screenshot, cached)
  - Title
  - Created date + agent role + harness
  - Status badges: Published / Pending / Unshared
  - Quick actions: Open `/s/<slug>`, Copy link, Unshare
- Sort by: most recent, title alpha
- Filter by: agent role, status, has-pending-changes

## CLI Examples

Agent flow:

```bash
# Agent writes the file
$ cat > comparison.html <<'EOF'
<!DOCTYPE html>
<html>
<head><title>RAG Approach Comparison</title>...</head>
<body>...</body>
</html>
EOF

# Validate
$ pan artifacts validate comparison.html --json
{"ok":true,"warnings":[],"size":48231,"hash":"sha256:abc123…"}

# Publish (validate + create in one)
$ pan artifacts create comparison.html --issue PAN-1052 --agent-role work
{"artifactId":"01HXYZ…","slug":"k3p9m2qr","url":"https://panopticon.localhost/s/k3p9m2qr","published":true}

# Later: edit file, check status
$ pan artifacts status comparison.html
pendingChanges: true
  currentHash:        sha256:def456…
  lastPublishedHash:  sha256:abc123…

# Republish
$ pan artifacts publish comparison.html
{"published":true,"url":"https://panopticon.localhost/s/k3p9m2qr"}
```

## Acceptance Criteria

- `pan artifacts validate` rejects: files with AWS/GitHub/OpenAI/Anthropic secrets, files > 1MB, files with `<img src="./…">`, files with `<script src="../…">`, files with `<link href="http://…">` (non-HTTPS)
- `pan artifacts create` publishes successfully to `panopticon.localhost/s/<slug>`
- The wrapper page shows correct provenance metadata
- The raw page at `/a/<slug>` is served from a different origin (`artifacts.panopticon.localhost`)
- `pendingChanges: true` correctly detected when file hash differs from last published; `false` otherwise
- `pan artifacts publish` updates the published hash on success
- `pan artifacts unshare` disables the URL (returns 410 Gone) but preserves file + DB record
- `pan artifacts list --workspace <id>` shows correct subset
- Dashboard workspace inspector renders Artifacts tab with thumbnails and quick actions
- Sandbox isolation: artifact's JS cannot access `panopticon.localhost` cookies (Playwright assertion passes)
- `--strict` mode catches: high-entropy strings, inline event handlers (`onclick="…"` without CSP), missing alt text on images
- New tests: validator regex coverage, hash comparison, slug uniqueness, sandbox isolation, provenance metadata, `pendingChanges` detection

## Test Plan

Unit:
- Validator: each regex pattern with positive + negative fixtures
- Asset path linter: each forbidden pattern + accepted patterns (data URLs, HTTPS)
- Hash comparison + `pendingChanges` logic
- Slug generation: uniqueness, URL-safety, length

Integration:
- Full lifecycle: validate → create → status (no changes) → edit file → status (pending) → publish → status (no changes) → unshare → URL returns 410
- Sandbox isolation: Playwright loads `/s/<slug>`, asserts iframe at `/a/<slug>` cannot read wrapper cookies
- Dashboard inspector: workspace with N artifacts renders N cards with correct thumbnails
- Concurrent publish race: two agents publishing different files don't collide on slug

## Out of Scope (Phase 2)

- Tunnel sharing (Tailscale Funnel / ngrok) — CLI flag stubbed, implementation deferred
- XSS deep scanning — high false-positive rate; defer
- Artifact templating helpers (`pan artifacts new --template comparison`)
- In-dashboard artifact editor
- Artifact version history UI (the `supersedes` chain is in the schema; UI to navigate it defers)
- Public registry / artifact marketplace

## Files Likely Touched

- `src/lib/artifacts/` (new) — validation, publish, sandbox config
- `src/cli/commands/artifacts.ts` (new) — full CLI surface
- `src/dashboard/server/routes/artifacts.ts` (new) — `/api/artifacts/*`, `/s/<slug>`, `/a/<slug>`
- `src/dashboard/frontend/src/components/ArtifactsTab.tsx` (new)
- `src/dashboard/frontend/src/components/ArtifactWrapper.tsx` (new) — the `/s/<slug>` React component
- `packages/contracts/src/types.ts` — `Artifact`, `ArtifactValidationResult`, `ArtifactStatus`
- `infra/traefik/dynamic/artifacts.toml` (new) — `artifacts.panopticon.localhost` route
- `dist/scripts/render-thumbnail.ts` (new) — Playwright headless thumbnail generator
- `tests/lib/artifacts/*.test.ts` (new) — validator, publish, sandbox
- `tests/integration/artifacts-lifecycle.test.ts` (new)
- `docs/ARTIFACTS.md` (new) — operator + agent guide
