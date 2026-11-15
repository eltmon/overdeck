# OKF Skill

`/okf` maintains a project knowledge wiki in Open Knowledge Format (OKF): Markdown concepts with YAML frontmatter, deterministic validation, and optional shareable embedding shards.

## Requirements

- git
- gh
- Python 3
- PyYAML

Embedding commands also need Ollama or an API key for the selected provider.

## Install

[eltmon/okf](https://github.com/eltmon/okf) is the canonical home of this skill. Releases are git tags named `vX.Y.Z`.

**With Overdeck.** Overdeck vendors one release tag (recorded in its `sync-sources/skills/okf/.okf-skill-version`), and `pan sync` installs it into `~/.claude/skills/okf` (Claude Code) and `~/.agents/skills/okf` (Codex, Pi). Do not edit those copies: `pan sync` replaces local edits, and `pan doctor` warns when an installed copy's version differs from the vendored one. Change the skill here, tag a release, and re-vendor it in Overdeck.

**Standalone Claude Code.** Clone the repo and symlink it so `git pull` updates it in place:

```bash
git clone https://github.com/eltmon/okf.git ~/Projects/okf
mkdir -p ~/.claude/skills
ln -s ~/Projects/okf ~/.claude/skills/okf
```

**Standalone Codex or Pi.** Both read the shared Agent Skills directory:

```bash
mkdir -p ~/.agents/skills
ln -s ~/Projects/okf ~/.agents/skills/okf
```

To pin a release, run `git -C ~/Projects/okf checkout vX.Y.Z`. If you also run Overdeck on the same machine, skip the symlinks and let `pan sync` manage the copies.

The skill remains portable. Its core scripts do not import Overdeck and require only git, gh, Python 3, and PyYAML for non-embedding workflows.

## 5-Minute Quickstart

1. Create or connect a bundle:

   ```bash
   /okf init
   ```

2. Document the area you are about to change:

   ```bash
   /okf study "overtime calculations"
   ```

3. Pull focused prompt context before implementation:

   ```bash
   /okf extract "overtime calculations" --budget 1200
   ```

4. After implementation, capture what the session learned:

   ```bash
   /okf retro
   ```

5. Validate before opening or merging the knowledge PR:

   ```bash
   /okf validate --strict
   ```

## Commands

| Command | Summary |
| --- | --- |
| `/okf init` | Create or connect the knowledge bundle and pointer file. |
| `/okf open [--no-install] [--no-browser]` | Open the configured bundle in the local visual knowledge viewer. |
| `/okf author "<topic>"` | Write or update one concept for one idea. |
| `/okf convert <path>` | Convert existing docs into OKF without destructive edits. |
| `/okf sync [--topic "<focus>"]` | Update concepts from code or documentation diffs. |
| `/okf study "<focus>"` | Pre-feature pass that documents current behavior. |
| `/okf retro` | Post-implementation pass that captures rediscovered knowledge. |
| `/okf extract "<query>" [--budget <tokens>]` | Return ranked, token-budgeted, cited concepts for prompts. |
| `/okf validate [--strict]` | Run the deterministic conformance gate. |
| `/okf lint` | Run advisory semantic patrol. |
| `/okf embed [--profile <name>]` | Update embedding shards and rebuild the local index. |
| `/okf publish --out <dir> [--check]` | Build a public static site from public concepts, with redaction. |

## The Three Loops

### Study

Run `/okf study "<focus>"` before planning or implementation. The pass researches the current codebase, writes what exists today, and cites evidence. This turns rediscovery into durable concepts before the work starts.

### Sync

Run `/okf sync [--topic "<focus>"]` when code or docs change. The pass maps diffs to concepts, updates affected pages, appends `log.md`, regenerates indexes, and validates.

### Retro

Run `/okf retro` after implementation. The pass asks what knowledge would have made the work easier, then files those answers as concepts through the knowledge PR flow.

## Publishing a bundle

`/okf publish` builds a read-only static site from the bundle's public concepts. The site has one page per public concept, an index page per published directory, and a client-side search page. It is plain HTML, CSS, one script and a JSON index, with no server code and no CDN, so any static host works. Deploying the site is outside the skill.

```bash
python3 <okf-skill-dir>/scripts/publish.py --bundle . --check
python3 <okf-skill-dir>/scripts/publish.py --bundle . --out _site
```

**Visibility.** A concept is published only when its frontmatter says `x_visibility: public`, or when it has no `x_visibility` and the root `schema.md` sets `x_visibility_default: public`. Without `schema.md` or that key, every concept is private. Any value other than `public` or `private` stops the run with an error.

```yaml
# schema.md frontmatter
x_visibility_default: public
# a concept that must stay off the site
x_visibility: private
```

A private concept has no page, no index line, no search record and no backlink. A link to it renders as plain text, and the link text stays, so do not put secrets in link text. `log.md`, non-Markdown files and dot-directories are never published.

**Redaction profile.** Before rendering, `publish.py` rewrites every published string with regex rules. Built-in rules always apply unless you disable them: `home-path-unix`, `home-path-windows`, `ipv4`, `github-token`, `openai-style-key`, `aws-access-key`, `slack-token` and `private-key-block`. Add your own rules in `okf-publish.yaml` at the bundle root (start from `templates/okf-publish.yaml`):

```yaml
okf_publish_version: "0.1"
disable_default_rules: []        # for example [ipv4] when version numbers trip it
rules:
  - id: stream-box-host
    pattern: '\bstream-box\.lan\b'
    replace: '[internal-host]'
private_strings:                 # literal, case-insensitive, matches across line breaks
  - Alice Example
```

Use `publish.py --bundle . --check` as the CI gate. It exits 2 when any rule matches text in a public concept or a published index page. It names the rule and the file line, never the matched text, because CI logs of public repos are public. Fix the source text, then rerun. A rule that matches a public concept ID or directory name is always an error, because URLs cannot be redacted.

**Sample Cloudflare Pages setup.** This workflow checks the bundle and deploys `_site` on every push to `main`:

```yaml
name: Publish knowledge site
on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: eltmon/okf
          ref: vX.Y.Z            # a release that includes scripts/publish.py
          path: .okf-skill        # dot-directory: the publisher skips it
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python3 -m pip install PyYAML
      - run: python3 .okf-skill/scripts/publish.py --bundle . --check
      - run: python3 .okf-skill/scripts/publish.py --bundle . --out _site
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy _site --project-name=<your-pages-project>
```

For GitHub Pages, upload `_site` with `actions/upload-pages-artifact` and deploy it with `actions/deploy-pages`; every link is page-relative, so the site works under a project subpath. Search fetches `search-index.json`, so preview the site with `python3 -m http.server --directory _site` rather than opening the files directly. See [references/publish.md](references/publish.md) for the full rules.

## Reading Rules

When using a bundle for answers or prompt context:

1. read `index.md` first.
2. load only relevant concepts.
3. answer only from loaded concepts.
4. cite concept IDs.
5. never invent missing knowledge.
