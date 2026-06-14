---
scope: dev
---
### Authoring bundled rules ("add a universal rule" / "add a dev rule")

When asked to add a **universal rule** or **dev rule**, you are authoring a
bundled rule in the panopticon-cli repo:

1. Create `sync-sources/rules/<kebab-slug>.md`:

   ```markdown
   ---
   scope: universal   # or: dev
   ---
   ### <Imperative title — the rule in one line>

   <Body: what to do, the one-line WHY, how to apply.>
   ```

2. Match the voice of the existing rules: imperative, concrete, includes the
   why. Look at two neighbors in `sync-sources/rules/` before writing.
3. **`scope: universal` costs context in every session on every machine** —
   keep it as short as the rule allows. `scope: dev` folds in only on a
   panopticon-cli source checkout; mechanics and tooling detail belong there.
4. Run `pan sync`, then verify the rule landed in the rendered harness context
   files: `~/.claude/CLAUDE.md` (managed region), `~/.panopticon/context/pi-global.md`,
   and `~/.panopticon/context/codex-global.md`.
5. Commit and push — bundled rules ship with the package, so an uncommitted
   rule exists only on this machine.
6. If the rule introduces new canonical terminology, update
   `docs/CONTEXT-LAYERS.md` and the user-facing
   `configuration/context-layers.mdx` in the same commit.

**"project rule"** and **"machine rule"** requests are NOT bundled rules — they
edit the project layer (`<root>/.pan/context/project.md`) or global layer
(`~/.panopticon/context/global.md`) directly; no panopticon-cli checkout
involved. See the context-nomenclature rule for the full routing table.
