/**
 * PAN-2593: children must resolve the same Node this server runs on.
 *
 * `pan up` launches the server with an explicit Node 22 binary, but the process
 * PATH can be bare system dirs — so every spawned child (verification-gate
 * npm/typecheck, git hooks, build steps) resolved /usr/bin/node (v18) and
 * modern-Node tooling (rolldown's util.styleText) failed with confusing,
 * workspace-dependent errors.
 *
 * Side-effect module: prepend the running binary's directory to PATH. Imported
 * FIRST in main.ts so it runs before any other imported module can shell out
 * (ESM import order). Idempotent.
 */
import { dirname, delimiter } from 'node:path';

const execDir = dirname(process.execPath);
const parts = (process.env.PATH ?? '').split(delimiter);
if (!parts.includes(execDir)) {
  process.env.PATH = execDir + delimiter + (process.env.PATH ?? '');
}
