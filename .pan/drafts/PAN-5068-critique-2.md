plan-digest: cb04de7045b26c9ed5737cc769335ebb7dc7159b906ad8ce9c94a43af99f4ee3

## blocks-the-design: eager String masks a fetch error

The W-1 replacement initializes `text` with `String(error)` before its `error instanceof Error` branch ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5068/.pan/drafts/PAN-5068.md), lines 90–100). The existing helper reads `error.message` without calling `toString` ([client.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5068/src/lib/account/client.ts), lines 90–92). I reran this case in Node: for `class OddError extends Error { toString() { throw new Error('toString failed'); } }`, the existing expression returns `network down`, while the proposed initialization throws `toString failed`. After the third device-code failure, that secondary exception would replace the required `AccountClientError`; D-1 explicitly supports any thrown fetch value. Initialize the text inside the `Error` and non-`Error` branches so `String(error)` runs only for non-Errors, and add this regression case to W-1.

## sharpens-framing: unchanged fallback conflicts with redaction

FR-2 says errors without a usable cause return *exactly* the old `error.message` or `String(error)` ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5068/.pan/drafts/PAN-5068.md), line 43), while NFR-2 and the W-1 snippet redact request secrets from that same text (lines 50 and 90–100). Both cannot hold when a no-cause error message contains a token or code. State that FR-2 preserves the old formatting **before secret redaction**, and add a no-cause message containing a request secret to the redaction cases.

## sharpens-framing: device-code redaction lacks a test

NFR-2 names the device code, and W-1 passes `code.deviceCode` at the poll catch site ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5068/.pan/drafts/PAN-5068.md), lines 50 and 104–109). W-1's redaction cases cover only the authorization code, verifier and token (lines 116–123). The actual poll catch returns the helper's text after three failures ([client.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5068/src/lib/account/client.ts), lines 162–174). Add a fake-timer poll test whose thrown cause includes `code.deviceCode`, and assert the returned detail contains `[redacted]` and no device code.
