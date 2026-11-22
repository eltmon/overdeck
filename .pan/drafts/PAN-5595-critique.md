plan-digest: 57201f0358a887a58d108550ab42c19a0b4d81763122524673e1aca139a4b0ec

## blocks-the-design: Verify the stage ID before approval

The PRD's exact timeout message lists `<name>` and immediately tells the maintainer to approve `<stage-id>` ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5595/.pan/drafts/PAN-5595.md), lines 98–106). WI-3 calls `npm stage view <stage-id>` optional (lines 234–240), and WI-4 omits it (line 252). [npm's stage documentation](https://docs.npmjs.com/cli/v11/commands/npm-stage/) says a package may have multiple staged versions. Following these instructions can publish a different version from the one whose job failed. Require the maintainer to identify and verify the stage ID's package and exact version before approval in the timeout message, both docs, and the timeout test.

## sharpens-framing: A clean-publish timeout is only suspected staging

D-5 correctly says staging is only *most likely* after `npm publish` exits 0 and the visibility poll times out ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5595/.pan/drafts/PAN-5595.md), lines 78 and 84–95). WI-3 then states without qualification that npm holds the version as staged (lines 231–233), and WI-4 says a visibility error means it is staged (line 252). Registry delay or failure would produce the same timeout, so the prescribed approval could find no stage. Make the docs and skill preserve D-5's distinction: confirm staging with `npm stage list`; if the exact version is absent, investigate registry visibility instead of asking for approval.

## sharpens-framing: Point to the actual Staged Packages page

The timeout message sends maintainers to the Staged Packages tab of `https://www.npmjs.com/package/<name>` ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5595/.pan/drafts/PAN-5595.md), line 104), and WI-3/WI-4 repeat the package-page route (lines 241 and 252). [npm's staged-publishing guide](https://docs.npmjs.com/staged-publishing/) places that tab in the signed-in account settings. Change all three instructions to say “Staged Packages in your npmjs.com account settings,” without the package-page URL.
