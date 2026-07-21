# Rebrand Deployment Runbook — External Ops

> The in-repo rebrand is **done** (PAN-1938/1960/1964/1952 all closed; cutover `cfcd3fca64`
> landed on `main` 2026-06-19). What remains is **external infrastructure** — DNS, hosting,
> and npm — that requires operator access to the Cloudflare, Vercel, Mintlify, and npm
> consoles. This runbook is the source of truth for those ops.
>
> **Target architecture:**
> - `overdeck.ai` → marketing landing site (static `site/`, served by Vercel)
> - `docs.overdeck.ai` → Mintlify docs (moved from `panopticon-cli.com`)
> - `panopticon-cli.com` → 301 redirect to `overdeck.ai`
> - npm: both `overdeck` (unscoped) and `@overdeck/core` resolve to the real release

## Prerequisites / current state (verified 2026-06-26)

| Resource | State |
|---|---|
| GitHub repo | Renamed → `eltmon/overdeck` (301 redirects old URLs) ✅ |
| `overdeck.ai` DNS | **Parked on Cloudflare, not resolving** ❌ |
| `docs.overdeck.ai` DNS | **Not configured** ❌ |
| `panopticon-cli.com` | **Live** — Mintlify docs on Vercel |
| `site/index.html` | Overdeck-branded, ready; `vercel.json` deploys `site/` ✅ |
| `@overdeck/core` on npm | v0.41.1 (the real package) ✅ |
| `overdeck` (unscoped) on npm | v0.0.1 — **deprecated placeholder** ❌ |
| `@panctl/cli` on npm | v0.21.0 — deprecated legacy |

---

## Phase 2a — Landing site: stand up `overdeck.ai` on Vercel

> **Status (2026-06-26): ✅ LIVE.** `https://overdeck.ai` and `https://www.overdeck.ai`
> serve the landing page over HTTPS (HTTP/2 200, Vercel, Let's Encrypt cert provisioned).
> Cloudflare A records `@` + `www` → `76.76.21.21` (DNS-only) are set and propagated.
> The Vercel project `eltmons-projects/overdeck` is created, GitHub-connected, and both
> domains are attached + verified.

**Deploy note:** the repo root is a monorepo with 20MB+ of tracked media, which exceeds
Vercel's 10MB CLI upload limit. Deploy from a clean dir containing only `site/` +
`scripts/install.sh` + `vercel.json` + `.vercel/` (the link). See the deploy snippet at
the bottom of this section. Images were compressed PNG/JPEG → WebP (25MB → 1.3MB).

### DNS records to add on Cloudflare (the only remaining step)

The `overdeck.ai` zone is on Cloudflare nameservers (`lucy/rick.ns.cloudflare.com`).
Add these records (Vercel-verified):

| Type | Name | Value | Proxy |
|---|---|---|---|
| `A` | `overdeck.ai` (=`@`) | `76.76.21.21` | DNS-only (grey cloud) |
| `A` | `www` | `76.76.21.21` | DNS-only (grey cloud) |

> Leave the Cloudflare proxy **off** (grey cloud) initially so Vercel can verify the
> domain. Once Vercel confirms "Valid Configuration", you may re-enable the orange-cloud
> proxy if desired.

After DNS propagates, verify: `curl -sI https://overdeck.ai` → 200, serving the landing
page. Vercel auto-runs verification and emails on completion.

### Redeploy snippet (from a clean dir)
```bash
D=/tmp/overdeck-site-deploy && rm -rf "$D" && mkdir -p "$D/scripts"
cp -r site/ scripts/install.sh vercel.json .vercel/ "$D/"
cp scripts/install.sh "$D/site/install"   # pre-build the /install one-liner
cd "$D" && vercel deploy --prod --yes
```

---

## Phase 2b — Docs: move Mintlify to `docs.overdeck.ai`

The Mintlify docs are currently published at `panopticon-cli.com` (Mintlify-hosted on
Vercel). Move them to `docs.overdeck.ai`.

1. **Add the custom domain in Mintlify.** In the Mintlify dashboard (dashboard.mintlify.com)
   → your project → Settings → Domains → add `docs.overdeck.ai`. Mintlify provides a
   CNAME target (e.g. `host.mintlify.com` or a Vercel-managed endpoint).

2. **Configure DNS in Cloudflare.** Add the CNAME Mintlify specifies:
   - `CNAME docs.overdeck.ai → <mintlify-provided-target>`.
   - Cloudflare proxy: Mintlify generally requires DNS-only (grey cloud) so their edge
     serves the SSL cert; enable proxying only if Mintlify documents it's supported.

3. **Verify.** `curl -sI https://docs.overdeck.ai` should return 308 → `/introduction`
   (Mintlify's entry redirect), matching the current `panopticon-cli.com` behavior.

4. **Update the docs homepage CTA** (already done in `docs.json`): the "Install" button
   points to `npmjs.com/package/overdeck`, GitHub links to `eltmon/overdeck`. No further
   `docs.json` changes needed.

---

## Phase 2c — Redirect `panopticon-cli.com` (DEFERRED — operator handles last)

> **Status: deferred.** The operator will handle `panopticon-cli.com` last, after
> `overdeck.ai` and `docs.overdeck.ai` are both live and stable. Do not touch this domain
> until then — it keeps serving the Mintlify docs as the active fallback.

When the time comes, external/cached links to `panopticon-cli.com/<doc-path>` must not
404. Since the old domain served **docs**, redirect doc paths to `docs.overdeck.ai`:

1. **Remove `panopticon-cli.com` from the Mintlify project** (after `docs.overdeck.ai` is
   verified and serving). This frees the domain.

2. **Set up a Cloudflare redirect rule.** Cloudflare → Rules → Redirect Rules on the
   `panopticon-cli.com` zone:
   - `*` → `https://docs.overdeck.ai${http.request.uri.path}` with a 301.
   - This preserves the path: `panopticon-cli.com/quickstart` →
     `docs.overdeck.ai/quickstart`.
   - The bare domain (`panopticon-cli.com`) → `https://docs.overdeck.ai`.

   > Alternative: redirect to `overdeck.ai` (marketing site) instead — it has prominent
   > "Docs" links so users reach docs in one click. Path-preserving → `docs.overdeck.ai`
   > is friendlier for deep-linked doc URLs.

---

## Phase 5 — npm: publish the unscoped `overdeck` package

The goal: `npx overdeck` works, in addition to `npx @overdeck/core`. The `overdeck`
(unscoped) package currently sits at v0.0.1 and is deprecated. It must resolve to the
same release as `@overdeck/core`.

**Two viable mechanisms** (pick one):

### Option A — dual-publish in the release workflow (recommended)

Add a publish step to [`.github/workflows/release.yml`](../.github/workflows/release.yml)
that swaps the package name and republishes the same tarball under `overdeck`:

```yaml
- name: Publish unscoped `overdeck` alias
  env:
    PKG_VERSION: ${{ needs.<version-source>.outputs.version }}
  run: |
    # The trusted-publisher config on npmjs.com for `overdeck` must pin this
    # repo + workflow (same as @overdeck/core) for OIDC to authorize the publish.
    if npm view "overdeck@${PKG_VERSION}" version >/dev/null 2>&1; then
      echo "overdeck@${PKG_VERSION} already published — skipping"
      exit 0
    fi
    # Temporarily publish the built dist under the unscoped name
    npm version "${PKG_VERSION}" --no-git-tag-version --allow-same-version
    node -e "const p=require('./package.json'); p.name='overdeck'; require('fs').writeFileSync('./package.json', JSON.stringify(p,null,2)+'\n')"
    npm publish --provenance --access public --tag latest
```

> ⚠️ The **Trusted Publisher** config for the `overdeck` package on npmjs.com must be set
> to allow this repo + workflow file, exactly like `@overdeck/core`. Without it, OIDC
> publish is rejected. Configure this once in the npm web UI.

### Option B — thin wrapper package

Publish a tiny `overdeck` package whose only job is `@overdeck/core`:

```json
{
  "name": "overdeck",
  "version": "<same-as-core>",
  "bin": { "overdeck": "./node_modules/@overdeck/core/dist/cli/index.js" },
  "dependencies": { "@overdeck/core": "<same-version>" }
}
```

This is simpler to reason about but adds an install hop. Option A produces a single
self-contained tarball under each name.

### After publish

- **Deprecate `@panctl/cli`** (idempotent metadata write; the release workflow already
  notes this is done for `overdeck` and `@eltmon/panctl`).
- Once `overdeck` is live at the real version, update the landing site (`site/index.html`)
  and README to lead with `npx overdeck` (currently `npx @overdeck/core`, which also works).

---

## Phase 6 — Legacy cleanup (DECISION: keep import functionality)

**Decision (operator, 2026-06-26):** We **keep** the `panopticon.db` import functionality
and the `~/.panopticon` legacy-home resolver in the codebase. We do **not** delete users'
old `panopticon.db`, and the `--seed-from-legacy` import path stays available.

This means the following carve-outs from PAN-1964 **remain indefinitely** (do not remove):

- [`src/lib/paths.ts`](../src/lib/paths.ts) `getLegacyHome()` → `~/.panopticon` (import-only).
- `src/lib/overdeck/legacy-import.ts` — the opt-in importer that reads the old DB.
- The `LegacyImportDialog` in the dashboard settings (the "Import conversations from old
  Panopticon" UI).
- `pan up --seed-from-legacy` CLI path.

The live primary DB is `~/.overdeck/panopticon.db` (filename retained during the in-flight
dual-DB migration to `overdeck.db`; PAN-1908/1938/1979/1983). That filename is a separate
concern from the import functionality and is tracked under the data-remodel epic.

---

## Checklist

- [ ] **2a** Vercel project created for `eltmon/overdeck` (outputs `site/`)
- [ ] **2a** `overdeck.ai` domain added + DNS configured on Cloudflare
- [ ] **2a** `https://overdeck.ai` returns 200 (landing page live)
- [ ] **2b** `docs.overdeck.ai` added as Mintlify custom domain
- [ ] **2b** DNS configured; `https://docs.overdeck.ai` serves docs
- [ ] **2c** (DEFERRED — last) `panopticon-cli.com` removed from Mintlify; 301 redirect → `docs.overdeck.ai`
- [ ] **5** Trusted Publisher configured for `overdeck` on npmjs.com
- [ ] **5** `overdeck` published at the real version (dual-publish)
- [ ] **5** `@panctl/cli` deprecated on npm
- [ ] **(post-5)** Landing site + README lead with `npx overdeck`
- [ ] **6** Confirmed: legacy import + `~/.panopticon` resolver retained (no deletion)
