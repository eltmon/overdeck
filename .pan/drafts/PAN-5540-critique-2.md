plan-digest: 278627e413ee403874dcd283ae2c2afb84bfa0dac7c3f6ea0f46cad24358964e

## blocks-the-design: Group add command fails for valid config groups

The formatter must print `run pan skills pack add --group <name>` for every group with missing members (`.pan/drafts/PAN-5540.md`, lines 141–150). But `addGroupPacks` calls `addOnePack(member, undefined, options)` and exits 1 if any member fails (`src/cli/commands/skills.ts`, lines 410–427). `addOnePack` requires a default URL and ref (lines 437–441); `mattpocock` and `deft` have no default ref (`src/lib/skill-packs/adapters.ts`, lines 115–122), and custom group members have no known defaults. Thus a valid config group containing either gets a command advertised as able to add it that cannot succeed. Change the formatter and group-row guidance to present the group command only when every missing member has the CLI defaults it needs; otherwise show the per-member commands and state that a ref or URL must be supplied. Cover both group shapes in the formatter test.

## blocks-the-design: Commit change has no second trust path

The plan says a 409 `commit-changed` answer re-previews the member (`.pan/drafts/PAN-5540.md`, lines 63 and 395). The same step then ends the loop and replaces the action with `Added <n> pack(s).` and **Close** (line 395), so the new preview cannot be trusted in that dialog. Keep the trust action available after re-preview, with the new commit displayed, and require another click before adding that member. Add a test that completes the second trust.

## blocks-the-design: Route bodies accept undocumented fields

FR-6 says preview accepts only `{ id }` and add accepts only `{ id, commit }` (`.pan/drafts/PAN-5540.md`, line 42). WI-6 instead rejects only `url`, `ref`, and `adapter`; it explicitly requires no other key checks (lines 367–369). A body such as `{ "id": "remotion", "options": { "ref": "main" } }` would pass the prescribed parser. Reject every key outside the exact allowlist for each route, and test an unrelated extra key as well as the three named keys.

## blocks-the-design: Last add unmounts the result dialog

WI-4 says `AvailablePacksSection` returns `null` once nothing is left to show (`.pan/drafts/PAN-5540.md`, line 258). WI-7 puts the dialog's Add button and dialog state in that section (lines 388 and 395–396), then invalidates `['skill-packs-available']` before showing the success result (line 395). If the operator adds the final missing pack, the refreshed section returns `null`, unmounting its open dialog before `Added <n> pack(s).` or **Close** can render. Host the dialog outside the list's empty return, or keep the section mounted until the operator closes it. Test the final-pack add through `AvailablePacksSection`, including the result and close control.
