---
name: pan-skill-creator
description: Guide for Overdeck developers on creating and distributing skills
triggers:
  - create a skill
  - add a skill
  - new skill for overdeck
  - make skill available to all users
---

# Overdeck Skill Development Guide

**This skill is for Overdeck developers only.** It teaches how to create skills that are distributed with Overdeck to all users.

## Where Skill Sources Live

All skill sources are under `sync-sources/` in the overdeck repo (PAN-1201). Nothing at the repo root is a skill source.

| Location | Purpose | Distributed to users |
|----------|---------|---------------------|
| `sync-sources/skills/<name>/` | Public skills for all users | Yes |
| `sync-sources/dev-skills/<name>/` | Developer-only skills | Only in dev mode (see below) |
| `<projectRoot>/.pan/skills/<name>/` | One project's own skills | To that project's workspaces |

A skill is a directory that contains `SKILL.md`. It can also contain `references/` and `scripts/`.

## How `pan sync` Distributes Skills

`pan sync` **copies** files. It does not create symlinks.

1. **Source tree.** `pan sync` normally reads the package's own `sync-sources/`. When the `pan` binary runs from a `pan reload` generation (`~/.overdeck/deployments/dashboard/.pan-reload-generation-{a,b}`), it reads `sync-sources/` in the checkout that generation was built from instead (`repoRoot` in `~/.overdeck/active-dashboard-bundle.json`, usually the primary checkout). If that checkout is behind `origin/main`, `pan sync` distributes stale skills and prints a staleness warning.
2. **Cache.** Every directory in `sync-sources/skills/` is copied into `~/.overdeck/skills/`. In dev mode, `sync-sources/dev-skills/` is copied after it, so a dev skill replaces a public skill with the same name.
3. **Harness targets.** From the cache, skills are copied into `~/.claude/skills/` (Claude Code) and `~/.agents/skills/` (Codex, Pi). A hash manifest (`~/.claude/.overdeck-manifest.json`) tracks each copied file. A file that you edited at the target is reported as user-modified and is not overwritten.
4. **Workspaces.** New workspaces get the cached skills copied into `<workspace>/.claude/skills/`.

**Dev mode** means the package root has a `src/` directory: a source checkout or a `pan reload` generation. An npm install has no `src/`, so it never gets dev skills.

Changes reach **new** sessions only. A running session keeps the skill list it started with.

## Creating a New Skill

### Step 1: Pick the location and name

- Public skill → `sync-sources/skills/<name>/`
- Dev-only skill → `sync-sources/dev-skills/<name>/`

Follow [`docs/SKILLS-CONVENTION.md`](../../../docs/SKILLS-CONVENTION.md) for the name:

- A skill that wraps one CLI verb is named `pan-<verb>`, exactly the verb.
- A workflow, reference, or topical skill still takes the `pan-` prefix.

### Step 2: Write `SKILL.md`

```markdown
---
name: pan-my-skill
description: "Workflow: one line that says what it does and when to use it"
triggers:
  - phrase a user would say
  - another phrase
allowed-tools:
  - Bash
  - Read
---

# pan-my-skill

Instructions the agent follows...
```

The `description` is what the agent sees in its skill list. Say when to use the skill, not only what it is.

### Step 3: Update the skill-set fixture (public skills only)

`tests/fixtures/synced-skills.txt` lists every directory in `sync-sources/skills/`, sorted, one per line. `tests/fixtures/synced-skills.test.ts` fails if a skill is added, renamed, or removed without updating it. Regenerate it:

```bash
UPDATE_FIXTURES=1 npx vitest run tests/fixtures/synced-skills.test.ts
```

### Step 4: Lint

```bash
bash scripts/lint-skills.sh   # also runs inside `npm run lint`
```

The linter checks every `pan <verb>` flag and subcommand that a CLI-wrapper skill mentions against the built CLI (`dist/cli/index.js`), so build first. `npm run lint:no-state-layer` also scans every `.md` under `sync-sources/` for references to the deleted state layer.

A skill that only instructs the agent does not add a CLI verb, so it does not touch the composer slash-command manifest (`packages/contracts/src/composer-commands.generated.ts`). That manifest is generated from CLI commands.

### Step 5: Try it locally

```bash
pan sync
pan skills | grep pan-my-skill
```

If your commit is not yet in the checkout that `pan sync` reads (see step 1 of the distribution flow), copy the directory into `~/.claude/skills/` by hand to try it.

### Step 6: Commit and push

```bash
git add sync-sources/skills/pan-my-skill tests/fixtures/synced-skills.txt
git commit -m "feat(skills): add pan-my-skill for <purpose>"
git push
```

Use the `pan-commit` skill for commit-message rules. An unpushed skill exists only on your machine.

## Updating an Existing Skill

1. Edit `sync-sources/skills/<name>/SKILL.md` (or `sync-sources/dev-skills/`).
2. Run the linter.
3. Commit and push.
4. Run `pan sync`. It overwrites the managed copies unless a user edited them.

## Skill Best Practices

1. **Clear triggers.** Include the phrases a user actually says.
2. **Actionable instructions.** Tell the agent exactly what to run, with examples.
3. **One purpose per skill.** Link related skills in a "See also" section instead of merging them.
4. **Record the traps.** When a workflow has a failure mode you hit once, write the check that avoids it into the skill.
