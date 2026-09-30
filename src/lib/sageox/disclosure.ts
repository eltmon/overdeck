/**
 * What SageOx sends off the machine (PAN-2444 FR-16). A leaf module with no
 * imports so the skill-pack adapters, the launch step and the dashboard pack
 * row can all share one text without an import cycle.
 */
export const SAGEOX_DISCLOSURE =
  'SageOx records agent sessions on this machine. With uploads off (the default) Overdeck runs `ox` with the network off: nothing is sent. ' +
  'With uploads on for a project, redacted session transcripts and session metadata are uploaded to the SageOx cloud ledger for that repo, ' +
  'and `ox` may fetch team context. Requires the eltmon/ox build; see `pan doctor`.';
