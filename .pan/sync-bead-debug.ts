import { Effect } from "effect";
import { syncBeadStatusToVBrief } from "../src/lib/vbrief/beads";

const workspacePath = "/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1919";

const closedBeads = [
  { id: "workspace-2yrwn", title: "PAN-1919: Fix async dashboard status-override split-brain (dag.ts → record)" },
  { id: "workspace-so3r8", title: "PAN-1919: Route done.ts continue read/write to the record" },
  { id: "workspace-0z0y6", title: "PAN-1919: Route planning-spawn continue write to the record" },
  { id: "workspace-3091t", title: "PAN-1919: Route cloister context-builder readers to the record" },
  { id: "workspace-nsvkk", title: "PAN-1919: Route dashboard routes continue read/write to the record" },
  { id: "workspace-fmjxz", title: "PAN-1919: Complete the backfill to cover statusOverrides + harness/model at schemaVersion 2" },
];

async function main() {
  for (const bead of closedBeads) {
    const result = await Effect.runPromise(syncBeadStatusToVBrief(bead.id, workspacePath, "completed", bead.title));
    console.log(`sync ${bead.id}:`, result);
  }
}

main().catch(err => console.error(err));
