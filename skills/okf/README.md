# OKF Skill

`/okf` maintains a project knowledge wiki in Open Knowledge Format (OKF): Markdown concepts with YAML frontmatter, deterministic validation, and optional shareable embedding shards.

## Requirements

- git
- gh
- Python 3
- PyYAML

Embedding commands also need Ollama or an API key for the selected provider.

## Install

Overdeck users receive this skill through `pan sync`.

Standalone Claude Code users can copy-install it:

```bash
mkdir -p ~/.claude/skills
cp -R skills/okf ~/.claude/skills/okf
```

The copied skill remains portable. Its core scripts do not import Overdeck and require only git, gh, Python 3, and PyYAML for non-embedding workflows.

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
