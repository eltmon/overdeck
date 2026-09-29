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

## The Three Loops

### Study

Run `/okf study "<focus>"` before planning or implementation. The pass researches the current codebase, writes what exists today, and cites evidence. This turns rediscovery into durable concepts before the work starts.

### Sync

Run `/okf sync [--topic "<focus>"]` when code or docs change. The pass maps diffs to concepts, updates affected pages, appends `log.md`, regenerates indexes, and validates.

### Retro

Run `/okf retro` after implementation. The pass asks what knowledge would have made the work easier, then files those answers as concepts through the knowledge PR flow.

## Reading Rules

When using a bundle for answers or prompt context:

1. read `index.md` first.
2. load only relevant concepts.
3. answer only from loaded concepts.
4. cite concept IDs.
5. never invent missing knowledge.
