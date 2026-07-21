export function buildFinalFailureInstructions(issueId: string): string {
  return `## NEEDS-YOU: Verification stuck

Automatic verification paused after repeated failures so it does not keep spending cycles on the same failing gate.

Fix every reported failure, commit and push the corrections, then run \`pan done ${issueId} -c "<summary>"\`. That command resets verification and returns the latest commit to the normal review, test, and merge pipeline. If you cannot complete the fixes, report the concrete blocker for operator help.`;
}
